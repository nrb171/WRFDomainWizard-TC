import proj4 from 'proj4';
import { EarthRadius, WrfProjections } from './constants';

// PROJ4 strings based on https://github.com/NCAR/wrf-python/blob/develop/src/wrf/projection.py
export class WrfProjection {

    // Spherical latlon used by WRF
    // see https://fabienmaussion.info/2018/01/06/wrf-projection/
    static _wrf_proj = '+units=m +proj=longlat +a=' + EarthRadius + ' +b=' + EarthRadius + '  +towgs84=0,0,0 +no_defs=True';

    constructor(params) {

        this._params = Object.assign({
            map_proj: null,
            ref_lat: null,
            ref_lon: null,
            truelat1: null,
            truelat2: null,
            stand_lon: null,
            dx: null,
            dy: null,
            e_we: null,
            e_sn: null
        },
        params);

        // validate that the parameters required by the selected projection
        // are finite numbers; without this check, NaN/undefined values
        // propagate silently through proj4 and surface much later as
        // cryptic 'Invalid IJ coordinates' errors
        const requireFinite = (names) => {
            for (const name of names) {
                const raw = this._params[name];
                const value = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
                if (!isFinite(value)) {
                    throw new Error(
                        `Projection '${this._params.map_proj}' requires a finite value ` +
                        `for ${name}, but got '${this._params[name]}'`);
                }
                this._params[name] = value;
            }
        };

        switch (this._params.map_proj) {
            case WrfProjections.lambert:
                requireFinite(['ref_lat', 'truelat1', 'truelat2', 'stand_lon']);
                break;
            case WrfProjections.mercator:
                requireFinite(['truelat1']);
                break;
            case WrfProjections.polar:
                requireFinite(['truelat1', 'stand_lon']);
                break;
            case WrfProjections.latlon:
                requireFinite(['stand_lon']);
                break;
        }

        switch (this._params.map_proj) {

            // Lambert Conformal Conic
            case WrfProjections.lambert:
                this._proj4 = '+units=m'
                    + ' +proj=lcc'
                    + ' +lat_1=' + this._params.truelat1
                    + ' +lat_2=' + this._params.truelat2
                    + ' +lat_0=' + this._params.ref_lat
                    + ' +lon_0=' + this._params.stand_lon
                    + ' +a=' + EarthRadius
                    + ' +b=' + EarthRadius
                    + ' +towgs84=0,0,0'
                    + ' +no_defs=True';
                break;

            // Mercator
            case WrfProjections.mercator:
                this._proj4 = '+units=m'
                    + ' +proj=merc'
                    + ' +lat_ts=' + this._params.truelat1
                    + ' +lon_0=' + this._getValue(this._params.stand_lon, 0)
                    + ' +a=' + EarthRadius
                    + ' +b=' + EarthRadius
                    + ' +towgs84=0,0,0'
                    + ' +no_defs=True'
                    + ' +nadgrids=null';
                break;

            // Polar stereographic
            case WrfProjections.polar: {

                const hemi = (this._params.truelat1 < 0) ? -90 : 90;
                const lat_ts = this._params.truelat1;

                this._proj4 = '+units=m'
                    + ' +proj=stere'
                    + ' +lat_0=' + hemi
                    + ' +lon_0=' + this._params.stand_lon
                    + ' +lat_ts=' + lat_ts
                    + ' +a=' + EarthRadius
                    + ' +b=' + EarthRadius;

                break;
            }

            // Regular latitude-longitude, or cylindrical equidistant
            case WrfProjections.latlon: {

                this._proj4 = '+units=m'
                    + ' +proj=eqc'
                    + ' +lon_0=' + this._params.stand_lon
                    + ' +a=' + EarthRadius
                    + ' +b=' + EarthRadius
                    + ' +nadgrids=null'
                    + ' +towgs84=0,0,0'
                    + ' +no_defs=True';

                break;
            }

            default:
                throw ("Unsupported projection " + this._wps.map_proj);
        }
    }

    _getValue(value, defaultValue) {
        if (isNaN(value) || value === null || value === undefined) {
            return defaultValue;
        }
        return value;
    }

    latlon_to_ij(lat, lon) {

        if (!isFinite(lat) || !isFinite(lon)) {
            throw new Error(`Invalid lat-lon coordinates (${lat}, ${lon})`);
        }

        const ij = proj4(
            WrfProjection._wrf_proj,
            this._proj4,
            [Number(lon), Number(lat)]);

        if (!isFinite(ij[0]) || !isFinite(ij[1])) {
            throw new Error(
                `Projection of (${lat}, ${lon}) failed for '${this._params.map_proj}'; ` +
                'check the projection parameters');
        }

        return ij;
    }

    ij_to_latlon(i, j) {

        if (!isFinite(i) || !isFinite(j)) {
            throw new Error(`Invalid IJ coordinates (${i}, ${j})`);
        }

        var lonlat = proj4(
            this._proj4,
            WrfProjection._wrf_proj,
            [Number(i), Number(j)]);

        if (!isFinite(lonlat[0]) || !isFinite(lonlat[1])) {
            throw new Error(
                `Inverse projection of (${i}, ${j}) failed for '${this._params.map_proj}'; ` +
                'check the projection parameters');
        }

        return [lonlat[1], lonlat[0]];
    }
}