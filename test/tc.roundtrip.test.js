import * as fs from 'fs';
import {
    parseStormTrack,
    computeTCDomains,
    createWPSNamelist,
    trackPositionAt
} from '../src/js/utils/tc';
import { WPSNamelist } from '../src/js/utils/namelist.wps';
import { Geogrid } from '../src/js/utils/geogrid';

const mariaGeojson = fs.readFileSync('samples/tracks/MARIA_2017_track.geojson', 'utf-8');

/**
 * Integration test exercising the same code path the UI uses:
 * track -> layout -> WPS namelist text -> namelist parser -> geogrid math.
 */
describe('TC layout to WPS namelist round trip', () => {

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

    const text = createWPSNamelist(layout).toString();
    const parsed = new WPSNamelist(text);

    test('namelist text parses back without errors', () => {
        expect(parsed.share.max_dom).toBe(3);
        expect(parsed.geogrid.map_proj).toBe('mercator');
        expect(parsed.geogrid.e_we).toEqual(layout.domains.map(d => d.e_we));
        expect(parsed.geogrid.e_sn).toEqual(layout.domains.map(d => d.e_sn));
        expect(parsed.geogrid.i_parent_start).toEqual(layout.domains.map(d => d.i_parent_start));
        expect(parsed.geogrid.dx).toBeCloseTo(27000, 0);
    });

    test('geogrids can be constructed for all domains', () => {

        const wpsBase = {
            map_proj: parsed.geogrid.map_proj,
            ref_lat: parsed.geogrid.ref_lat,
            ref_lon: parsed.geogrid.ref_lon,
            truelat1: parsed.geogrid.truelat1,
            truelat2: parsed.geogrid.truelat2,
            stand_lon: parsed.geogrid.stand_lon,
            dx: parsed.geogrid.dx,
            dy: parsed.geogrid.dy
        };

        let parent = null;
        const geogrids = [];
        for (let i = 0; i < parsed.share.max_dom; i++) {
            const geogrid = new Geogrid(`d${(i + 1).toString().padStart(2, '0')}`, Object.assign({}, wpsBase, {
                e_we: parsed.geogrid.e_we[i],
                e_sn: parsed.geogrid.e_sn[i],
                parent_grid_ratio: parsed.geogrid.parent_grid_ratio[i],
                i_parent_start: parsed.geogrid.i_parent_start[i],
                j_parent_start: parsed.geogrid.j_parent_start[i]
            }), parent);
            geogrids.push(geogrid);
            parent = geogrid;
        }

        // d01 corners must be finite and ordered
        const corners = geogrids[0].corners;
        expect(corners.ne[0]).toBeGreaterThan(corners.sw[0]);
        expect(corners.ne[1]).toBeGreaterThan(corners.sw[1]);

        // the storm position at start must be inside d02 (which starts
        // centered on the storm)
        const start = trackPositionAt(points, layout.startTime);
        const ij = geogrids[1].latlon_to_unstaggered_ij(start.lat, start.lon);
        expect(ij[0]).toBeGreaterThan(0);
        expect(ij[0]).toBeLessThan(parsed.geogrid.e_we[1] - 1);
        expect(ij[1]).toBeGreaterThan(0);
        expect(ij[1]).toBeLessThan(parsed.geogrid.e_sn[1] - 1);

        // ... and near its center (within 1.5 d01 cells of rounding)
        const centerOffset = Math.max(
            Math.abs(ij[0] - (parsed.geogrid.e_we[1] - 1) / 2) * geogrids[1].wps.dx / 3,
            Math.abs(ij[1] - (parsed.geogrid.e_sn[1] - 1) / 2) * geogrids[1].wps.dy / 3);
        expect(centerOffset).toBeLessThanOrEqual(1.5 * parsed.geogrid.dx);

        // every interpolated storm position stays inside d01
        for (let h = 0; h <= 72; h++) {
            const t = new Date(layout.startTime.getTime() + h * 3600 * 1000);
            const p = trackPositionAt(points, t);
            const pij = geogrids[0].latlon_to_unstaggered_ij(p.lat, p.lon);
            expect(pij[0]).toBeGreaterThan(0);
            expect(pij[0]).toBeLessThan(parsed.geogrid.e_we[0] - 1);
            expect(pij[1]).toBeGreaterThan(0);
            expect(pij[1]).toBeLessThan(parsed.geogrid.e_sn[0] - 1);
        }
    });
});
