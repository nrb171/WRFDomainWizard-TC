import { WrfProjection } from "./wrf.projection";
import { WrfProjections } from "./constants";
import { WPSNamelist } from "./namelist.wps";

/**
 * Utilities for setting up WRF tropical cyclone simulations:
 *  - Saffir-Simpson classification
 *  - storm track parsing and time interpolation
 *  - automatic domain layout: d01 sized to contain the moving d02..dN
 *    nest stack along the storm track, d03+ centered in their parents
 *  - vortex-following namelist.input generation
 */

// Saffir-Simpson scale. Thresholds in m/s (1-minute sustained wind).
export const SaffirSimpsonCategories = [
    { key: 'td', label: 'Tropical Depression', short: 'TD', min: 0, color: '#5ebaff' },
    { key: 'ts', label: 'Tropical Storm', short: 'TS', min: 17.5, color: '#00faf4' },
    { key: 'cat1', label: 'Category 1', short: 'C1', min: 32.7, color: '#ffffcc' },
    { key: 'cat2', label: 'Category 2', short: 'C2', min: 42.7, color: '#ffe775' },
    { key: 'cat3', label: 'Category 3', short: 'C3', min: 49.6, color: '#ffc140' },
    { key: 'cat4', label: 'Category 4', short: 'C4', min: 58.1, color: '#ff8f20' },
    { key: 'cat5', label: 'Category 5', short: 'C5', min: 70.0, color: '#ff6060' }
];

export const WindUnits = {
    ms: { key: 'ms', label: 'm/s', toMs: 1.0 },
    kt: { key: 'kt', label: 'kt', toMs: 0.514444 },
    mph: { key: 'mph', label: 'mph', toMs: 0.44704 }
};

/**
 * Classify wind speed on the Saffir-Simpson scale.
 * @param {number} vmax wind speed
 * @param {string} units 'ms'|'kt'|'mph', default 'ms'
 */
export function saffirSimpson(vmax, units) {
    const factor = (units && WindUnits[units]) ? WindUnits[units].toMs : 1.0;
    const ms = vmax * factor;
    let category = SaffirSimpsonCategories[0];
    for (const c of SaffirSimpsonCategories) {
        if (ms >= c.min) {
            category = c;
        }
    }
    return category;
}

/**
 * Parse a date string. Accepts 'YYYY-MM-DD HH:mm:ss', ISO-8601 and
 * WPS 'YYYY-MM-DD_HH:mm:ss'. All times are treated as UTC.
 * @returns {Date}
 */
export function parseTrackTime(value) {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === 'number') {
        return new Date(value);
    }
    let s = String(value).trim().replace('_', ' ');
    // normalize 'YYYY-MM-DD HH:mm:ss' to ISO UTC
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
        return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) {
        throw new StormTrackError(`Unable to parse time value '${value}'`);
    }
    return d;
}

/**
 * Format a Date as WPS date string 'YYYY-MM-DD_HH:mm:ss' (UTC).
 */
export function formatWpsDate(date) {
    const p = (n, l) => n.toString().padStart(l || 2, '0');
    return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}` +
        `_${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}

export class StormTrackError extends Error {
    constructor(message, ...args) {
        super(message, ...args);
        this.name = 'StormTrackError';
    }
}

/**
 * Parse a GeoJSON FeatureCollection of track points into a sorted array of
 * { time: Date, lat, lon, vmax, mslp, name } objects.
 *
 * Recognized properties (case-insensitive): time/datetime/date/ISO_TIME,
 * vmax/wind/max_wind/USA_WIND, mslp/pressure/pres/USA_PRES, name/NAME.
 */
export function parseStormTrack(geojson) {

    if (typeof geojson === 'string') {
        geojson = JSON.parse(geojson);
    }

    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        throw new StormTrackError('Storm track file must be a GeoJSON FeatureCollection');
    }

    const getProp = (props, names) => {
        const keys = Object.keys(props);
        for (const name of names) {
            const key = keys.find(k => k.toLowerCase() === name);
            if (key !== undefined && props[key] !== null && props[key] !== undefined) {
                return props[key];
            }
        }
        return null;
    };

    const points = [];
    for (const feature of geojson.features) {
        if (!feature.geometry || feature.geometry.type !== 'Point') {
            continue;
        }
        const props = feature.properties || {};
        const time = getProp(props, ['time', 'datetime', 'date', 'iso_time']);
        if (time === null) {
            continue;
        }
        points.push({
            time: parseTrackTime(time),
            lon: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            vmax: getProp(props, ['vmax', 'wind', 'max_wind', 'usa_wind']),
            mslp: getProp(props, ['mslp', 'pressure', 'pres', 'usa_pres']),
            name: getProp(props, ['name', 'storm', 'storm_name'])
        });
    }

    if (points.length < 2) {
        throw new StormTrackError('Storm track must contain at least two timestamped point features');
    }

    points.sort((a, b) => a.time - b.time);
    return points;
}

/**
 * Linearly interpolate the storm position at a given time.
 * @param {Array} points sorted track points
 * @param {Date|string} time
 * @returns {{lat: number, lon: number}}
 */
export function trackPositionAt(points, time) {
    const t = parseTrackTime(time).getTime();

    if (t <= points[0].time.getTime()) {
        return { lat: points[0].lat, lon: points[0].lon };
    }
    const last = points[points.length - 1];
    if (t >= last.time.getTime()) {
        return { lat: last.lat, lon: last.lon };
    }
    for (let i = 1; i < points.length; i++) {
        const t1 = points[i].time.getTime();
        if (t <= t1) {
            const t0 = points[i - 1].time.getTime();
            const f = (t1 === t0) ? 0 : (t - t0) / (t1 - t0);
            return {
                lat: points[i - 1].lat + f * (points[i].lat - points[i - 1].lat),
                lon: points[i - 1].lon + f * (points[i].lon - points[i - 1].lon)
            };
        }
    }
    return { lat: last.lat, lon: last.lon };
}

/**
 * Interpolate track positions between start and end at stepMinutes intervals.
 * Original track points inside the window are always included.
 */
export function interpolateTrack(points, start, end, stepMinutes) {
    const t0 = parseTrackTime(start).getTime();
    const t1 = parseTrackTime(end).getTime();

    if (t1 <= t0) {
        throw new StormTrackError('End time must be after start time');
    }

    const stepMs = (stepMinutes || 15) * 60 * 1000;
    const positions = [];

    for (let t = t0; t < t1; t += stepMs) {
        positions.push(trackPositionAt(points, t));
    }
    positions.push(trackPositionAt(points, t1));

    // include the original fix positions inside the window
    for (const p of points) {
        const t = p.time.getTime();
        if (t > t0 && t < t1) {
            positions.push({ lat: p.lat, lon: p.lon });
        }
    }
    return positions;
}

// minimum distance (in parent grid cells) between a nest boundary
// and its parent boundary; matches WRFDomainGrid.minNestGridPoints
const MIN_NEST_GRID_POINTS = 5;

/**
 * Compute a WRF domain layout for a moving-nest tropical cyclone simulation.
 *
 * d02 starts centered on the storm position at startTime and follows the
 * vortex. d03..dN are centered inside their parents. d01 is static and sized
 * so the entire moving d02..dN stack stays inside it (plus a safety buffer)
 * along the prescribed track between startTime and endTime.
 *
 * @param {object} opts
 * @param {Array}  opts.track          parsed storm track points
 * @param {Date|string} opts.startTime simulation start
 * @param {Date|string} opts.endTime   simulation end
 * @param {number} opts.maxDom         total number of domains (>= 2)
 * @param {number} opts.dx01           d01 grid spacing in meters
 * @param {number} opts.ratio          parent_grid_ratio for all nests (3 or 5)
 * @param {Array}  opts.nestSizesKm    sizes (width=height, km) of d02..dN
 * @param {number} opts.bufferCells    extra d01 cells beyond the d02 swath (default 10)
 * @param {string} opts.mapProj        only 'mercator' is supported
 *
 * @returns {object} layout { domains: [...], wps: {...}, warnings: [...] }
 */
export function computeTCDomains(opts) {

    const o = Object.assign({
        track: null,
        startTime: null,
        endTime: null,
        maxDom: 3,
        dx01: 27000,
        ratio: 3,
        nestSizesKm: null,
        bufferCells: 10,
        mapProj: WrfProjections.mercator
    }, opts);

    const warnings = [];

    if (!o.track || o.track.length < 2) {
        throw new StormTrackError('A storm track with at least two points is required');
    }
    if (o.maxDom < 2) {
        throw new StormTrackError('At least two domains are required for a moving nest setup');
    }
    if (o.ratio < 2) {
        throw new StormTrackError('parent_grid_ratio must be at least 2');
    }
    if (o.mapProj !== WrfProjections.mercator) {
        throw new StormTrackError('Only the mercator projection is currently supported for TC domains');
    }

    const startTime = parseTrackTime(o.startTime);
    const endTime = parseTrackTime(o.endTime);

    // grid spacing of each domain in meters
    const dx = [o.dx01];
    for (let k = 1; k < o.maxDom; k++) {
        dx.push(dx[k - 1] / o.ratio);
    }

    // default nest sizes if not provided: shrink by ~0.55 per level from 1000 km
    const nestSizesKm = [];
    for (let k = 0; k < o.maxDom - 1; k++) {
        if (o.nestSizesKm && o.nestSizesKm[k] > 0) {
            nestSizesKm.push(o.nestSizesKm[k]);
        }
        else {
            nestSizesKm.push(Math.round(1000 * Math.pow(0.55, k)));
        }
    }

    // --- compute e_we/e_sn for nests d02..dN (square domains) ---------------
    // constraints:
    //   (e_we - 1) % ratio == 0
    //   for k >= 3, the nest is centered in its parent:
    //     i_parent_start = ((e_we_parent - 1) - (e_we - 1)/ratio)/2 + 1 must be
    //     a positive integer => (e_we_parent - 1) - (e_we - 1)/ratio must be even
    const sizes = []; // e_we == e_sn for each nest, index 0 => d02
    for (let k = 0; k < o.maxDom - 1; k++) {
        const cells = Math.max(Math.round(nestSizesKm[k] * 1000 / dx[k + 1]), 2 * o.ratio);
        let e = cells + 1;

        // make (e - 1) a multiple of ratio
        const mod = (e - 1) % o.ratio;
        if (mod !== 0) {
            e += o.ratio - mod;
        }

        if (k > 0) {
            // center inside the parent nest: parity fix
            if (((sizes[k - 1] - 1) - (e - 1) / o.ratio) % 2 !== 0) {
                e += o.ratio;
            }
            // must fit inside parent with minimum boundary distance
            const maxSpan = (sizes[k - 1] - 1) - 2 * MIN_NEST_GRID_POINTS;
            if ((e - 1) / o.ratio > maxSpan) {
                let span = maxSpan;
                if (((sizes[k - 1] - 1) - span) % 2 !== 0) {
                    span -= 1;
                }
                e = span * o.ratio + 1;
                warnings.push(
                    `d${pad2(k + 2)} was reduced to ${((e - 1) * dx[k + 1] / 1000).toFixed(0)} km ` +
                    `to fit inside d${pad2(k + 1)}`);
            }
        }
        sizes.push(e);
    }

    // --- interpolate the track over the simulation window -------------------
    const positions = interpolateTrack(o.track, startTime, endTime, 15);

    // --- two-pass d01 fit ----------------------------------------------------
    // pass 1 with truelat1 = mean track latitude, pass 2 with truelat1 = d01
    // center latitude (the app convention for mercator domains)
    let truelat1 = positions.reduce((s, p) => s + p.lat, 0) / positions.length;
    let result = null;

    for (let pass = 0; pass < 2; pass++) {

        const projection = new WrfProjection({
            map_proj: WrfProjections.mercator,
            ref_lat: truelat1,
            ref_lon: positions[0].lon,
            truelat1: truelat1,
            stand_lon: 0,
            dx: dx[0],
            dy: dx[0]
        });

        const xy = positions.map(p => projection.latlon_to_ij(p.lat, p.lon));

        // half-extent of the d02 footprint in meters
        const half2 = (sizes[0] - 1) * dx[1] / 2;
        const buffer = o.bufferCells * dx[0];

        const xmin = Math.min(...xy.map(p => p[0])) - half2 - buffer;
        const xmax = Math.max(...xy.map(p => p[0])) + half2 + buffer;
        const ymin = Math.min(...xy.map(p => p[1])) - half2 - buffer;
        const ymax = Math.max(...xy.map(p => p[1])) + half2 + buffer;

        const e_we1 = Math.ceil((xmax - xmin) / dx[0]) + 1;
        const e_sn1 = Math.ceil((ymax - ymin) / dx[0]) + 1;

        const centerLatLon = projection.ij_to_latlon((xmin + xmax) / 2, (ymin + ymax) / 2);

        result = {
            projection: projection,
            e_we1: e_we1,
            e_sn1: e_sn1,
            ref_lat: centerLatLon[0],
            ref_lon: centerLatLon[1],
            xy: xy,
            sw: [xmin, ymin]
        };

        truelat1 = centerLatLon[0];
    }

    // --- place d02 at the storm position at startTime ------------------------
    // d01 SW corner in projected meters (grid-aligned around the center)
    const proj = result.projection;
    const centerXY = proj.latlon_to_ij(result.ref_lat, result.ref_lon);
    const swX = centerXY[0] - (result.e_we1 - 1) * dx[0] / 2;
    const swY = centerXY[1] - (result.e_sn1 - 1) * dx[0] / 2;

    const startPos = trackPositionAt(o.track, startTime);
    const startXY = proj.latlon_to_ij(startPos.lat, startPos.lon);

    const span2 = (sizes[0] - 1) / o.ratio; // d02 size in d01 cells

    const clampParentStart = (value, parentSize, span) => {
        const min = MIN_NEST_GRID_POINTS + 1;
        const max = parentSize - MIN_NEST_GRID_POINTS - span;
        return Math.min(Math.max(value, min), Math.max(max, min));
    };

    let i2 = Math.round((startXY[0] - swX) / dx[0] - span2 / 2) + 1;
    let j2 = Math.round((startXY[1] - swY) / dx[0] - span2 / 2) + 1;
    i2 = clampParentStart(i2, result.e_we1, span2);
    j2 = clampParentStart(j2, result.e_sn1, span2);

    // --- assemble per-domain parameters --------------------------------------
    const domains = [{
        id: 1,
        parent_id: 1,
        parent_grid_ratio: 1,
        i_parent_start: 1,
        j_parent_start: 1,
        e_we: result.e_we1,
        e_sn: result.e_sn1,
        dx: dx[0]
    }];

    for (let k = 0; k < o.maxDom - 1; k++) {
        let i_ps, j_ps;
        if (k === 0) {
            i_ps = i2;
            j_ps = j2;
        }
        else {
            // centered in parent
            i_ps = ((sizes[k - 1] - 1) - (sizes[k] - 1) / o.ratio) / 2 + 1;
            j_ps = i_ps;
        }
        domains.push({
            id: k + 2,
            parent_id: k + 1,
            parent_grid_ratio: o.ratio,
            i_parent_start: i_ps,
            j_parent_start: j_ps,
            e_we: sizes[k],
            e_sn: sizes[k],
            dx: dx[k + 1]
        });
    }

    // --- verify containment along the whole track ----------------------------
    // by construction d01 contains the swath; verify numerically and warn if
    // the storm comes within corral distance of the d01 boundary
    const corral = MIN_NEST_GRID_POINTS;
    let minEdgeCells = Infinity;
    for (const p of result.xy) {
        const di = (p[0] - swX) / dx[0];
        const dj = (p[1] - swY) / dx[0];
        const half = span2 / 2;
        minEdgeCells = Math.min(
            minEdgeCells,
            di - half,
            dj - half,
            (result.e_we1 - 1) - (di + half),
            (result.e_sn1 - 1) - (dj + half));
    }
    if (minEdgeCells < corral) {
        warnings.push(
            'The moving d02 approaches the d01 boundary closer than ' +
            `${corral} cells (minimum ${minEdgeCells.toFixed(1)}); increase the buffer`);
    }

    return {
        map_proj: WrfProjections.mercator,
        ref_lat: result.ref_lat,
        ref_lon: result.ref_lon,
        truelat1: truelat1,
        stand_lon: 0,
        startTime: startTime,
        endTime: endTime,
        domains: domains,
        minEdgeCells: minEdgeCells,
        warnings: warnings
    };
}

function pad2(n) {
    return n.toString().padStart(2, '0');
}

/**
 * Create a WPSNamelist object from a TC domain layout.
 * @param {object} layout result of computeTCDomains
 * @returns {WPSNamelist}
 */
export function createWPSNamelist(layout) {

    const ns = new WPSNamelist();
    const startDate = formatWpsDate(layout.startTime);
    const endDate = formatWpsDate(layout.endTime);

    ns.share.max_dom = layout.domains.length;
    ns.share.start_date = layout.domains.map(() => startDate);
    ns.share.end_date = layout.domains.map(() => endDate);
    ns.share.interval_seconds = 21600;

    ns.geogrid.map_proj = layout.map_proj;
    ns.geogrid.ref_lat = layout.ref_lat;
    ns.geogrid.ref_lon = layout.ref_lon;
    ns.geogrid.truelat1 = layout.truelat1;
    ns.geogrid.truelat2 = 0;
    ns.geogrid.stand_lon = layout.stand_lon;
    ns.geogrid.dx = layout.domains[0].dx;
    ns.geogrid.dy = layout.domains[0].dx;

    ns.geogrid.parent_id = layout.domains.map(d => d.parent_id);
    ns.geogrid.parent_grid_ratio = layout.domains.map(d => d.parent_grid_ratio);
    ns.geogrid.i_parent_start = layout.domains.map(d => d.i_parent_start);
    ns.geogrid.j_parent_start = layout.domains.map(d => d.j_parent_start);
    ns.geogrid.e_we = layout.domains.map(d => d.e_we);
    ns.geogrid.e_sn = layout.domains.map(d => d.e_sn);
    ns.geogrid.geog_data_res = layout.domains.map(() => 'default');

    return ns;
}

/**
 * Build a TC layout object from an existing WPSNamelist - the inverse of
 * createWPSNamelist. This allows the namelist.wps/namelist.input downloads
 * to reflect any fine-tuning done in the regular Domains panel after the
 * initial automatic layout, reusing the existing WPS code path.
 *
 * @param {WPSNamelist} ns
 * @param {Date|string} startTime
 * @param {Date|string} endTime
 * @returns {object} layout compatible with generateVortexFollowingNamelistInput
 */
export function layoutFromWPSNamelist(ns, startTime, endTime) {

    const asArray = (value) => Array.isArray(value) ? value : [value];

    const parentIds = asArray(ns.geogrid.parent_id);
    const ratios = asArray(ns.geogrid.parent_grid_ratio);
    const iStarts = asArray(ns.geogrid.i_parent_start);
    const jStarts = asArray(ns.geogrid.j_parent_start);
    const eWe = asArray(ns.geogrid.e_we);
    const eSn = asArray(ns.geogrid.e_sn);
    const maxDom = ns.share.max_dom;

    // grid spacing per domain, derived through the parent chain
    const dx = [ns.geogrid.dx];
    for (let i = 1; i < maxDom; i++) {
        dx.push(dx[parentIds[i] - 1] / ratios[i]);
    }

    const domains = [];
    for (let i = 0; i < maxDom; i++) {
        domains.push({
            id: i + 1,
            parent_id: parentIds[i],
            parent_grid_ratio: ratios[i],
            i_parent_start: iStarts[i],
            j_parent_start: jStarts[i],
            e_we: eWe[i],
            e_sn: eSn[i],
            dx: dx[i]
        });
    }

    return {
        map_proj: ns.geogrid.map_proj,
        ref_lat: ns.geogrid.ref_lat,
        ref_lon: ns.geogrid.ref_lon,
        truelat1: ns.geogrid.truelat1,
        stand_lon: ns.geogrid.stand_lon,
        startTime: parseTrackTime(startTime),
        endTime: parseTrackTime(endTime),
        domains: domains,
        warnings: []
    };
}

/**
 * Generate a namelist.input for a vortex-following moving nest simulation.
 *
 * Requires WRF compiled with moving nest support:
 *   ./configure  ->  select a "preset moves" / vortex-following nesting option
 *   (-DMOVE_NESTS -DVORTEX_CENTER)
 *
 * @param {object} layout  result of computeTCDomains
 * @param {object} options { vortexInterval, maxVortexSpeed, corralDist, trackLevel, timeStep }
 * @returns {string}
 */
export function generateVortexFollowingNamelistInput(layout, options) {

    const o = Object.assign({
        vortexInterval: 15,   // minutes between vortex position calculations
        maxVortexSpeed: 40,   // m/s, max assumed vortex translation speed
        corralDist: 8,        // cells the moving nest is kept from the parent boundary
        trackLevel: 50000,    // Pa, pressure level used to track the vortex
        timeStep: null,       // s, defaults to ~5*dx[km], capped for stability
        historyIntervalMinutes: 60
    }, options);

    const n = layout.domains.length;
    const start = layout.startTime;
    const end = layout.endTime;
    const runSeconds = Math.round((end - start) / 1000);
    const runDays = Math.floor(runSeconds / 86400);
    const runHours = Math.floor((runSeconds % 86400) / 3600);
    const runMinutes = Math.floor((runSeconds % 3600) / 60);

    const dx01km = layout.domains[0].dx / 1000;
    const timeStep = o.timeStep || Math.max(Math.round(5 * dx01km), 1);

    const p = (d) => d.toString();
    const list = (fn) => layout.domains.map(fn).join(', ');
    const dlist = (fn) => layout.domains.map(fn).join(',  ');

    const date = (d) => formatWpsDate(d).replace('_', '_');

    const startDates = layout.domains.map(() => `'${date(start)}'`).join(', ');
    const endDates = layout.domains.map(() => `'${date(end)}'`).join(', ');

    return `! namelist.input generated by WRF Domain Wizard - Tropical Cyclone edition
! Vortex-following moving nest configuration.
!
! IMPORTANT: WRF must be compiled with vortex-following moving nest support.
! When running ./configure, choose a nesting option that enables
! "preset moves"/"vortex following" (compiles with -DMOVE_NESTS -DVORTEX_CENTER).
! Domains d02..d${pad2(n)} will automatically follow the storm vortex.
! Review and complete the &physics section before running.

&time_control
 run_days                            = ${runDays},
 run_hours                           = ${runHours},
 run_minutes                         = ${runMinutes},
 run_seconds                         = 0,
 start_date                          = ${startDates},
 end_date                            = ${endDates},
 interval_seconds                    = 21600,
 input_from_file                     = ${list(() => '.true.')},
 history_interval                    = ${list(() => o.historyIntervalMinutes)},
 frames_per_outfile                  = ${list(() => 1)},
 restart                             = .false.,
 restart_interval                    = 7200,
 io_form_history                     = 2,
 io_form_restart                     = 2,
 io_form_input                       = 2,
 io_form_boundary                    = 2,
/

&domains
 time_step                           = ${timeStep},
 time_step_fract_num                 = 0,
 time_step_fract_den                 = 1,
 max_dom                             = ${n},
 e_we                                = ${dlist(d => p(d.e_we))},
 e_sn                                = ${dlist(d => p(d.e_sn))},
 e_vert                              = ${dlist(() => '45')},
 dx                                  = ${dlist(d => p(Math.round(d.dx)))},
 dy                                  = ${dlist(d => p(Math.round(d.dx)))},
 grid_id                             = ${dlist(d => p(d.id))},
 parent_id                           = ${dlist(d => p(d.parent_id))},
 i_parent_start                      = ${dlist(d => p(d.i_parent_start))},
 j_parent_start                      = ${dlist(d => p(d.j_parent_start))},
 parent_grid_ratio                   = ${dlist(d => p(d.parent_grid_ratio))},
 parent_time_step_ratio              = ${dlist(d => p(d.parent_grid_ratio))},
 feedback                            = 1,
 smooth_option                       = 0,
 ! --- vortex-following moving nest options ---
 vortex_interval                     = ${dlist(() => p(o.vortexInterval))},
 max_vortex_speed                    = ${dlist(() => p(o.maxVortexSpeed))},
 corral_dist                         = ${dlist(() => p(o.corralDist))},
 track_level                         = ${o.trackLevel},
 time_to_move                        = ${dlist(() => '0')},
/

&physics
 ! Suggested starting point for TC simulations - review before use!
 mp_physics                          = ${dlist(() => '6')},   ! WSM6
 cu_physics                          = ${dlist((d) => (d.dx > 10000 ? '1' : '0'))},   ! Kain-Fritsch on coarse grids only
 ra_lw_physics                       = ${dlist(() => '4')},   ! RRTMG
 ra_sw_physics                       = ${dlist(() => '4')},   ! RRTMG
 radt                                = ${dlist(() => p(Math.max(Math.round(dx01km), 1)))},
 bl_pbl_physics                      = ${dlist(() => '1')},   ! YSU
 sf_sfclay_physics                   = ${dlist(() => '1')},
 sf_surface_physics                  = ${dlist(() => '2')},   ! Noah LSM
 bldt                                = ${dlist(() => '0')},
 cudt                                = ${dlist(() => '5')},
 isftcflx                            = 1,                     ! TC air-sea flux option
 num_land_cat                        = 21,
/

&dynamics
 w_damping                           = 1,
 diff_opt                            = ${dlist(() => '1')},
 km_opt                              = ${dlist(() => '4')},
 diff_6th_opt                        = ${dlist(() => '0')},
 diff_6th_factor                     = ${dlist(() => '0.12')},
 base_temp                           = 290.,
 damp_opt                            = 3,
 zdamp                               = ${dlist(() => '5000.')},
 dampcoef                            = ${dlist(() => '0.2')},
 khdif                               = ${dlist(() => '0')},
 kvdif                               = ${dlist(() => '0')},
 non_hydrostatic                     = ${dlist(() => '.true.')},
 moist_adv_opt                       = ${dlist(() => '1')},
 scalar_adv_opt                      = ${dlist(() => '1')},
/

&bdy_control
 spec_bdy_width                      = 5,
 specified                           = .true., ${layout.domains.slice(1).map(() => '.false.').join(', ')}${n > 1 ? ',' : ''}
 nested                              = .false., ${layout.domains.slice(1).map(() => '.true.').join(', ')}${n > 1 ? ',' : ''}
/

&namelist_quilt
 nio_tasks_per_group                 = 0,
 nio_groups                          = 1,
/
`;
}
