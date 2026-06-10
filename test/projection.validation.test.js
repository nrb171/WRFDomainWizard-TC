import { WrfProjection } from '../src/js/utils/wrf.projection';

/**
 * Regression tests for 'Invalid IJ coordinates' errors: missing or
 * non-numeric projection parameters must fail immediately with a clear
 * message instead of propagating NaN through proj4 into the geogrid code.
 */
describe('WrfProjection parameter validation', () => {

    test('mercator requires a finite truelat1', () => {
        expect(() => new WrfProjection({ map_proj: 'mercator' }))
            .toThrow(/requires a finite value for truelat1/);
        expect(() => new WrfProjection({ map_proj: 'mercator', truelat1: NaN }))
            .toThrow(/truelat1/);
        expect(() => new WrfProjection({ map_proj: 'mercator', truelat1: undefined }))
            .toThrow(/truelat1/);
    });

    test('lambert requires ref_lat, truelat1, truelat2, stand_lon', () => {
        expect(() => new WrfProjection({ map_proj: 'lambert', ref_lat: 40, truelat1: 40, truelat2: 40 }))
            .toThrow(/stand_lon/);
        expect(() => new WrfProjection({ map_proj: 'lambert', ref_lat: 40, truelat1: 40, truelat2: 40, stand_lon: -100 }))
            .not.toThrow();
    });

    test('polar requires truelat1 and stand_lon', () => {
        expect(() => new WrfProjection({ map_proj: 'polar', truelat1: 70 }))
            .toThrow(/stand_lon/);
    });

    test('numeric strings are coerced', () => {
        const projection = new WrfProjection({ map_proj: 'mercator', truelat1: '15.5' });
        const ij = projection.latlon_to_ij(15.5, -50);
        expect(isFinite(ij[0])).toBe(true);
        expect(isFinite(ij[1])).toBe(true);
    });

    test('valid mercator round trip still works', () => {
        const projection = new WrfProjection({ map_proj: 'mercator', truelat1: 15 });
        const ij = projection.latlon_to_ij(15, -55);
        const latlon = projection.ij_to_latlon(ij[0], ij[1]);
        expect(latlon[0]).toBeCloseTo(15, 5);
        expect(latlon[1]).toBeCloseTo(-55, 5);
    });

    test('non-finite coordinates are rejected with detail', () => {
        const projection = new WrfProjection({ map_proj: 'mercator', truelat1: 15 });
        expect(() => projection.latlon_to_ij(NaN, -55)).toThrow(/Invalid lat-lon/);
        expect(() => projection.ij_to_latlon(NaN, 0)).toThrow(/Invalid IJ/);
        expect(() => projection.ij_to_latlon(Infinity, 0)).toThrow(/Invalid IJ/);
    });
});
