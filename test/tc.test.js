import { jest } from '@jest/globals';
import * as fs from 'fs';
import {
    saffirSimpson,
    parseStormTrack,
    parseTrackTime,
    formatWpsDate,
    trackPositionAt,
    interpolateTrack,
    computeTCDomains,
    createWPSNamelist,
    layoutFromWPSNamelist,
    generateVortexFollowingNamelistInput
} from '../src/js/utils/tc';
import { WrfProjection } from '../src/js/utils/wrf.projection';
import { WrfProjections } from '../src/js/utils/constants';

const mariaGeojson = fs.readFileSync('samples/tracks/MARIA_2017_track.geojson', 'utf-8');

describe('saffirSimpson', () => {
    test('classifies m/s wind speeds', () => {
        expect(saffirSimpson(15).short).toBe('TD');
        expect(saffirSimpson(20).short).toBe('TS');
        expect(saffirSimpson(35).short).toBe('C1');
        expect(saffirSimpson(45).short).toBe('C2');
        expect(saffirSimpson(52).short).toBe('C3');
        expect(saffirSimpson(60).short).toBe('C4');
        expect(saffirSimpson(75).short).toBe('C5');
    });

    test('supports knots', () => {
        expect(saffirSimpson(30, 'kt').short).toBe('TD');
        expect(saffirSimpson(64, 'kt').short).toBe('C1');
        expect(saffirSimpson(140, 'kt').short).toBe('C5');
    });
});

describe('parseTrackTime / formatWpsDate', () => {
    test('parses space separated UTC times', () => {
        const date = parseTrackTime('2017-09-16 12:00:00');
        expect(date.getTime()).toBe(Date.UTC(2017, 8, 16, 12, 0, 0));
    });

    test('parses WPS-style times', () => {
        const date = parseTrackTime('2017-09-16_12:00:00');
        expect(date.getTime()).toBe(Date.UTC(2017, 8, 16, 12, 0, 0));
    });

    test('parses datetime-local values', () => {
        const date = parseTrackTime('2017-09-16T12:00');
        expect(date.getTime()).toBe(Date.UTC(2017, 8, 16, 12, 0, 0));
    });

    test('formats WPS dates', () => {
        expect(formatWpsDate(new Date(Date.UTC(2017, 8, 16, 6, 0, 0)))).toBe('2017-09-16_06:00:00');
    });
});

describe('parseStormTrack', () => {
    test('parses the MARIA sample track', () => {
        const points = parseStormTrack(mariaGeojson);
        expect(points.length).toBe(68);
        expect(points[0].name).toBe('MARIA');
        expect(points[0].lat).toBeCloseTo(12.2);
        expect(points[0].lon).toBeCloseTo(-49.7);
        expect(points[0].mslp).toBe(1006);
        // points must be time sorted
        for (let i = 1; i < points.length; i++) {
            expect(points[i].time.getTime()).toBeGreaterThanOrEqual(points[i - 1].time.getTime());
        }
    });

    test('rejects non-track files', () => {
        expect(() => parseStormTrack('{"type": "Feature"}')).toThrow();
        expect(() => parseStormTrack('{"type": "FeatureCollection", "features": []}')).toThrow();
    });
});

describe('trackPositionAt', () => {
    const points = parseStormTrack(mariaGeojson);

    test('returns exact positions at fix times', () => {
        const position = trackPositionAt(points, '2017-09-16 18:00:00');
        expect(position.lat).toBeCloseTo(12.2);
        expect(position.lon).toBeCloseTo(-51.7);
    });

    test('interpolates between fixes', () => {
        const position = trackPositionAt(points, '2017-09-16 15:00:00');
        expect(position.lat).toBeCloseTo(12.2);
        expect(position.lon).toBeCloseTo((-49.7 + -51.7) / 2);
    });

    test('clamps outside the track time range', () => {
        const before = trackPositionAt(points, '2017-09-01 00:00:00');
        expect(before.lat).toBeCloseTo(12.2);
        expect(before.lon).toBeCloseTo(-49.7);
    });
});

describe('interpolateTrack', () => {
    const points = parseStormTrack(mariaGeojson);

    test('rejects an inverted window', () => {
        expect(() => interpolateTrack(points, '2017-09-20 00:00:00', '2017-09-18 00:00:00')).toThrow();
    });

    test('produces positions covering the window', () => {
        const positions = interpolateTrack(points, '2017-09-18 00:00:00', '2017-09-20 00:00:00', 60);
        expect(positions.length).toBeGreaterThanOrEqual(49);
    });
});

describe('computeTCDomains', () => {
    const points = parseStormTrack(mariaGeojson);

    const layout = computeTCDomains({
        track: points,
        startTime: '2017-09-18 00:00:00',
        endTime: '2017-09-21 00:00:00',
        maxDom: 4,
        dx01: 27000,
        ratio: 3,
        nestSizesKm: [1000, 550, 300],
        bufferCells: 10
    });

    test('produces the requested number of domains', () => {
        expect(layout.domains.length).toBe(4);
    });

    test('nest dimensions satisfy WPS constraints', () => {
        for (let i = 1; i < layout.domains.length; i++) {
            const d = layout.domains[i];
            expect((d.e_we - 1) % d.parent_grid_ratio).toBe(0);
            expect((d.e_sn - 1) % d.parent_grid_ratio).toBe(0);
            expect(Number.isInteger(d.i_parent_start)).toBe(true);
            expect(Number.isInteger(d.j_parent_start)).toBe(true);
            expect(d.i_parent_start).toBeGreaterThanOrEqual(6);
            expect(d.j_parent_start).toBeGreaterThanOrEqual(6);
        }
    });

    test('d03 and deeper are centered in their parents', () => {
        for (let i = 2; i < layout.domains.length; i++) {
            const d = layout.domains[i];
            const parent = layout.domains[i - 1];
            const spanInParent = (d.e_we - 1) / d.parent_grid_ratio;
            // equal distance to both parent boundaries
            const left = d.i_parent_start - 1;
            const right = (parent.e_we - 1) - (left + spanInParent);
            expect(left).toBe(right);
        }
    });

    test('nests fit inside their parents', () => {
        for (let i = 1; i < layout.domains.length; i++) {
            const d = layout.domains[i];
            const parent = layout.domains[i - 1];
            const spanI = (d.e_we - 1) / d.parent_grid_ratio;
            const spanJ = (d.e_sn - 1) / d.parent_grid_ratio;
            expect(d.i_parent_start + spanI).toBeLessThanOrEqual(parent.e_we);
            expect(d.j_parent_start + spanJ).toBeLessThanOrEqual(parent.e_sn);
        }
    });

    test('grid spacing follows the nest ratio', () => {
        expect(layout.domains[0].dx).toBe(27000);
        expect(layout.domains[1].dx).toBe(9000);
        expect(layout.domains[2].dx).toBe(3000);
        expect(layout.domains[3].dx).toBe(1000);
    });

    test('d01 contains the moving d02 footprint along the whole track', () => {

        // rebuild the d01 projection and verify every interpolated storm
        // position keeps the d02 box inside d01 with the buffer margin
        const d01 = layout.domains[0];
        const d02 = layout.domains[1];

        const projection = new WrfProjection({
            map_proj: WrfProjections.mercator,
            ref_lat: layout.ref_lat,
            ref_lon: layout.ref_lon,
            truelat1: layout.truelat1,
            stand_lon: 0,
            dx: d01.dx,
            dy: d01.dx
        });

        const center = projection.latlon_to_ij(layout.ref_lat, layout.ref_lon);
        const swX = center[0] - (d01.e_we - 1) * d01.dx / 2;
        const swY = center[1] - (d01.e_sn - 1) * d01.dx / 2;

        const half = (d02.e_we - 1) * d02.dx / 2;
        const positions = interpolateTrack(points, layout.startTime, layout.endTime, 15);

        for (const p of positions) {
            const xy = projection.latlon_to_ij(p.lat, p.lon);
            expect(xy[0] - half).toBeGreaterThanOrEqual(swX);
            expect(xy[0] + half).toBeLessThanOrEqual(swX + (d01.e_we - 1) * d01.dx);
            expect(xy[1] - half).toBeGreaterThanOrEqual(swY);
            expect(xy[1] + half).toBeLessThanOrEqual(swY + (d01.e_sn - 1) * d01.dx);
        }

        expect(layout.minEdgeCells).toBeGreaterThanOrEqual(5);
    });

    test('a short window produces a smaller d01 than a long window', () => {
        const small = computeTCDomains({
            track: points,
            startTime: '2017-09-18 00:00:00',
            endTime: '2017-09-19 00:00:00',
            maxDom: 2,
            dx01: 27000,
            ratio: 3,
            nestSizesKm: [1000],
            bufferCells: 10
        });
        const big = computeTCDomains({
            track: points,
            startTime: '2017-09-17 00:00:00',
            endTime: '2017-09-23 00:00:00',
            maxDom: 2,
            dx01: 27000,
            ratio: 3,
            nestSizesKm: [1000],
            bufferCells: 10
        });
        expect(big.domains[0].e_we * big.domains[0].e_sn)
            .toBeGreaterThan(small.domains[0].e_we * small.domains[0].e_sn);
    });

    test('oversized nests are shrunk to fit their parents with a warning', () => {
        const layoutShrunk = computeTCDomains({
            track: points,
            startTime: '2017-09-18 00:00:00',
            endTime: '2017-09-19 00:00:00',
            maxDom: 3,
            dx01: 27000,
            ratio: 3,
            nestSizesKm: [300, 290],
            bufferCells: 10
        });
        const d02 = layoutShrunk.domains[1];
        const d03 = layoutShrunk.domains[2];
        expect((d03.e_we - 1) / 3).toBeLessThanOrEqual((d02.e_we - 1) - 10);
        expect(layoutShrunk.warnings.length).toBeGreaterThan(0);
    });
});

describe('createWPSNamelist', () => {
    const points = parseStormTrack(mariaGeojson);
    const layout = computeTCDomains({
        track: points,
        startTime: '2017-09-18 00:00:00',
        endTime: '2017-09-21 00:00:00',
        maxDom: 3,
        dx01: 27000,
        ratio: 3,
        nestSizesKm: [1000, 550],
        bufferCells: 10
    });

    test('produces a consistent WPS namelist', () => {
        const ns = createWPSNamelist(layout);
        expect(ns.share.max_dom).toBe(3);
        expect(ns.share.start_date).toEqual([
            '2017-09-18_00:00:00', '2017-09-18_00:00:00', '2017-09-18_00:00:00']);
        expect(ns.geogrid.map_proj).toBe('mercator');
        expect(ns.geogrid.parent_id).toEqual([1, 1, 2]);
        expect(ns.geogrid.parent_grid_ratio).toEqual([1, 3, 3]);
        expect(ns.geogrid.e_we.length).toBe(3);

        const text = ns.toString();
        expect(text).toContain('&geogrid');
        expect(text).toContain('mercator');
    });
});

describe('layoutFromWPSNamelist', () => {
    const points = parseStormTrack(mariaGeojson);
    const layout = computeTCDomains({
        track: points,
        startTime: '2017-09-18 00:00:00',
        endTime: '2017-09-21 00:00:00',
        maxDom: 3,
        dx01: 27000,
        ratio: 3,
        nestSizesKm: [1000, 550],
        bufferCells: 10
    });

    test('round trips through createWPSNamelist', () => {
        const ns = createWPSNamelist(layout);
        const rebuilt = layoutFromWPSNamelist(ns, layout.startTime, layout.endTime);

        expect(rebuilt.domains.length).toBe(layout.domains.length);
        for (let i = 0; i < layout.domains.length; i++) {
            expect(rebuilt.domains[i]).toEqual(layout.domains[i]);
        }
        expect(rebuilt.ref_lat).toBeCloseTo(layout.ref_lat);
        expect(rebuilt.startTime.getTime()).toBe(layout.startTime.getTime());
    });

    test('reflects manual edits to the namelist', () => {
        const ns = createWPSNamelist(layout);
        // simulate a user resizing d03 in the Domains panel
        ns.geogrid.e_we[2] = ns.geogrid.e_we[2] + 6;
        ns.geogrid.i_parent_start[2] = ns.geogrid.i_parent_start[2] - 1;

        const rebuilt = layoutFromWPSNamelist(ns, layout.startTime, layout.endTime);
        expect(rebuilt.domains[2].e_we).toBe(layout.domains[2].e_we + 6);
        expect(rebuilt.domains[2].i_parent_start).toBe(layout.domains[2].i_parent_start - 1);

        // and the edited layout feeds straight into namelist.input generation
        const text = generateVortexFollowingNamelistInput(rebuilt, {});
        expect(text).toContain(`${rebuilt.domains[2].e_we}`);
    });

    test('derives nest grid spacing through the parent chain', () => {
        const ns = createWPSNamelist(layout);
        const rebuilt = layoutFromWPSNamelist(ns, layout.startTime, layout.endTime);
        expect(rebuilt.domains[0].dx).toBeCloseTo(27000);
        expect(rebuilt.domains[1].dx).toBeCloseTo(9000);
        expect(rebuilt.domains[2].dx).toBeCloseTo(3000);
    });
});

describe('generateVortexFollowingNamelistInput', () => {
    const points = parseStormTrack(mariaGeojson);
    const layout = computeTCDomains({
        track: points,
        startTime: '2017-09-18 00:00:00',
        endTime: '2017-09-21 00:00:00',
        maxDom: 3,
        dx01: 27000,
        ratio: 3,
        nestSizesKm: [1000, 550],
        bufferCells: 10
    });

    test('contains the vortex-following options', () => {
        const text = generateVortexFollowingNamelistInput(layout, {});
        expect(text).toContain('vortex_interval');
        expect(text).toContain('max_vortex_speed');
        expect(text).toContain('corral_dist');
        expect(text).toContain('track_level');
        expect(text).toContain('max_dom                             = 3');
        expect(text).toContain("start_date                          = '2017-09-18_00:00:00'");
        expect(text).toContain('run_days                            = 3');
    });

    test('honors custom vortex options', () => {
        const text = generateVortexFollowingNamelistInput(layout, {
            vortexInterval: 10,
            maxVortexSpeed: 30,
            corralDist: 12
        });
        expect(text).toMatch(/vortex_interval\s+= 10/);
        expect(text).toMatch(/max_vortex_speed\s+= 30/);
        expect(text).toMatch(/corral_dist\s+= 12/);
    });
});
