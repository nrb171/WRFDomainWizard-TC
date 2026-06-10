# WRF Domain Wizard - Tropical Cyclone Edition

A fork of [WRFDomainWizard](https://github.com/JiriRichter/WRFDomainWizard) specialized for setting up **tropical cyclone simulations** with vortex-following moving nests.

## Tropical Cyclone workflow

The fork adds a *Tropical Cyclone* sidebar tab (wind icon) that streamlines TC domain setup:

1. **Upload a storm track** as a GeoJSON FeatureCollection of `Point` features with `time`, `vmax`, `mslp`, and `name` properties (a sample is included in `samples/tracks/MARIA_2017_track.geojson`). Track points are plotted and colored by Saffir-Simpson category (a wind-unit selector handles `vmax` in m/s, kt, or mph).
2. **Pick the simulation window** by clicking track points on the map (*Set as start* / *Set as end* in the point popup) or by typing start/end times (UTC). Points outside the window are faded.
3. **Define the nest structure**: number of domains, d01 grid spacing, `parent_grid_ratio`, the size in km of each nest (d02...dN), and a safety buffer.
4. **Build Domains** then performs all calculations:
   - d02 starts centered on the storm position at the start time and is intended to follow the vortex during the run;
   - d03 and deeper are exactly centered inside their parents (they move with d02 as a stack);
   - d01 is automatically positioned and sized (Mercator projection) so the moving d02...dN stack **always stays inside it along the prescribed track**, with the requested buffer; the closest approach of d02 to the d01 boundary is reported;
   - the resulting layout is loaded into the regular *Domains* panel where it can be inspected, fine-tuned, and saved as `namelist.wps`.
5. **namelist.input** downloads a vortex-following `namelist.input` template with the computed grid structure plus `vortex_interval`, `max_vortex_speed`, `corral_dist`, and `track_level` settings. Note that WRF must be compiled with moving-nest/vortex-following support (`-DMOVE_NESTS -DVORTEX_CENTER`), and the `&physics` section should be reviewed before use.

### Running locally

The app is a static site - serve the repository root with any web server:

```bash
python3 -m http.server 8000        # then open http://localhost:8000
```

or, with Node.js installed:

```bash
npm install
npm run dev                        # build + live-reload dev server
```

To rebuild the bundle after changing the source: `npm run build`. To run the test suite (includes the TC domain math tests): `npm test`. A headless browser smoke test of the TC workflow is available via `node test/smoke.tc.mjs` (see the file header for setup).

Like the upstream project, the repository can be served directly by GitHub Pages from the repository root.

---

# WRF Domain Wizard (upstream)

The WRF Domain Wizard is implemented as a client-side SPA (Single-page application) and can be used to define model domains for the [WRF Preprocessing System (WPS)](https://www2.mmm.ucar.edu/wrf/users/wrf_users_guide/build/html/wps.html). WPS is a set of three programs whose collective role is to prepare input to the real program for real-data simulations. Each program reads parameters from a common namelist file - namelist.wps.

[Official](https://wrfdomainwizard.net/)
[Preview](https://jiririchter.github.io/WRFDomainWizard/)

## Limitation
- The current version of the tool only helps with the definition of parameters for the [geogrid](https://www2.mmm.ucar.edu/wrf/users/wrf_users_guide/build/html/wps.html#step1-define-model-domains-with-geogrid) section.
- Support for NMM and the associated rotated lat-lon projection are not implemented
- Support for ARW global lat-lon is not implemented

## Test

A sample namelist.wps file has been created for each major projection and the test the geographic transformation code. The test expects the corners of all domains to align with the corners from the geogrid program output. The geogrid corner locations are obtained from the unstaggered corner_lats and corner_lons attributes of the geobrid output file and are displayed as small round markers.

- [Lambert](https://wrfdomainwizard.net/#lambert)
- [Mercator](https://wrfdomainwizard.net/#mercator)
- [Polar](https://wrfdomainwizard.net/#polar)
- [Lat-Lon](https://wrfdomainwizard.net/#lat-lon_region)

## Resources

- [wrf-python](https://github.com/NCAR/wrf-python)
    - [Projections](https://github.com/NCAR/wrf-python/blob/develop/src/wrf/projection.py)

- [PROJ4JS](https://github.com/proj4js/proj4js)

- [Weather Research and Forecasting Model](https://www2.mmm.ucar.edu/wrf/users/)
    - [User Guide](https://www2.mmm.ucar.edu/wrf/users/wrf_users_guide/build/html/index.html)
    - [WRF Preprocessing System (WPS)](https://www2.mmm.ucar.edu/wrf/users/wrf_users_guide/build/html/wps.html)
    - [wrf-model/WRF](https://github.com/wrf-model/WRF)
    - [wrf-model/WPS](https://github.com/wrf-model/WPS)

## Issue and Suggestions

Please, report any issues or feaure requests using the project [Issues](https://github.com/JiriRichter/WRFDomainWizard/issues).

