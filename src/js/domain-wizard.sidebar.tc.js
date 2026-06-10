import { errorMessageBox } from "./domain-wizard.dialog.message-box";
import { StormTrackLayer } from "./leaflet/leaflet.layer.storm-track";
import {
    computeTCDomains,
    createWPSNamelist,
    layoutFromWPSNamelist,
    generateVortexFollowingNamelistInput,
    parseTrackTime,
    formatWpsDate,
    StormTrackError
} from "./utils/tc";
import { saveAs } from "file-saver";

/**
 * Sidebar pane that streamlines setting up a WRF tropical cyclone
 * simulation:
 *
 *  1. upload a GeoJSON storm track (points colored by Saffir-Simpson category)
 *  2. pick simulation start/end times by clicking track points or typing
 *  3. define the nest structure (max_dom, d01 dx, ratio, nest sizes)
 *  4. d01 is automatically sized to contain the moving d02..dN stack along
 *     the prescribed track; d03+ are centered in their parents
 *  5. the layout is loaded into the regular Domains panel for fine-tuning
 *     and a vortex-following namelist.input can be downloaded
 */
export class SidebarTropicalCyclone {

    constructor(map, sidebar, sidebarDomains) {

        this.map = map;
        this.sidebar = sidebar;
        this.sidebarDomains = sidebarDomains;
        this.trackLayer = null;
        this.layout = null;

        const container = sidebar.getContainer().querySelector('#tropical-cyclone');
        this.container = container;

        // controls
        const buttonOpen = container.querySelector('#button-tc-track-open');
        const buttonRemove = container.querySelector('#button-tc-track-remove');
        const inputFile = container.querySelector('#input-tc-track-file');
        const trackInfo = container.querySelector('#tc-track-info');
        const stormName = container.querySelector('#tc-storm-name');
        const stormPeriod = container.querySelector('#tc-storm-period');
        const selectWindUnits = container.querySelector('#tc-wind-units');
        const form = container.querySelector('#tc-form');
        const inputStart = container.querySelector('#tc-start');
        const inputEnd = container.querySelector('#tc-end');
        const selectMaxDom = container.querySelector('#tc-max-dom');
        const inputDx = container.querySelector('#tc-dx');
        const selectRatio = container.querySelector('#tc-ratio');
        const inputBuffer = container.querySelector('#tc-buffer');
        const containerNestSizes = container.querySelector('#tc-nest-sizes');
        const inputVortexInterval = container.querySelector('#tc-vortex-interval');
        const inputMaxVortexSpeed = container.querySelector('#tc-max-vortex-speed');
        const inputCorralDist = container.querySelector('#tc-corral-dist');
        const divSummary = container.querySelector('#tc-summary');
        const divWarnings = container.querySelector('#tc-warnings');
        const buttonBuild = container.querySelector('#tc-build-domains');
        const buttonSaveNamelistWps = container.querySelector('#tc-save-namelist-wps');
        const buttonSaveNamelistInput = container.querySelector('#tc-save-namelist-input');

        this._controls = {
            inputStart, inputEnd, stormName, stormPeriod, trackInfo, form,
            buttonRemove, divSummary, divWarnings, buttonSaveNamelistInput,
            buttonSaveNamelistWps, containerNestSizes, selectMaxDom
        };

        $('[title]', $(container)).tooltip();

        // --- track file handling ---------------------------------------------
        buttonOpen.addEventListener('click', () => inputFile.click());

        inputFile.addEventListener('change', (e) => {
            if (!e.target.files || e.target.files.length === 0) {
                return;
            }
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onerror = () => errorMessageBox('File Open Error', 'Unable to read file!');
            reader.onload = () => {
                try {
                    this._loadTrack(reader.result);
                }
                catch (error) {
                    if (error instanceof StormTrackError || error instanceof SyntaxError) {
                        errorMessageBox('Storm Track Error', error.message);
                    }
                    else {
                        throw error;
                    }
                }
            };
            reader.readAsText(file);
            inputFile.value = null;
        });

        buttonRemove.addEventListener('click', () => this._removeTrack());

        selectWindUnits.addEventListener('change', () => {
            if (this.trackLayer) {
                this.trackLayer.setWindUnits(selectWindUnits.value);
            }
        });

        // --- simulation window -----------------------------------------------
        const onWindowChange = () => this._updateTrackWindow();
        inputStart.addEventListener('change', onWindowChange);
        inputEnd.addEventListener('change', onWindowChange);

        // --- nest size inputs --------------------------------------------------
        selectMaxDom.addEventListener('change', () => this._renderNestSizeInputs());
        this._renderNestSizeInputs();

        // --- build -------------------------------------------------------------
        buttonBuild.addEventListener('click', () => {

            form.classList.remove('was-validated');
            if (!form.checkValidity()) {
                form.classList.add('was-validated');
                return;
            }

            try {
                const layout = computeTCDomains({
                    track: this.trackLayer.getPoints(),
                    startTime: this._readTime(inputStart),
                    endTime: this._readTime(inputEnd),
                    maxDom: parseInt(selectMaxDom.value, 10),
                    dx01: parseInt(inputDx.value, 10),
                    ratio: parseInt(selectRatio.value, 10),
                    nestSizesKm: this._readNestSizes(),
                    bufferCells: parseInt(inputBuffer.value, 10)
                });

                this.layout = layout;
                this._showSummary(layout);
                this._showWarnings(layout.warnings);

                // load the computed layout into the regular Domains panel
                this.sidebarDomains.loadNamelist(createWPSNamelist(layout));

                buttonSaveNamelistWps.disabled = false;
                buttonSaveNamelistInput.disabled = false;
            }
            catch (error) {
                errorMessageBox('Domain Setup Error', error.message || String(error));
                if (!(error instanceof StormTrackError)) {
                    // unexpected - keep details in the console for debugging
                    console.error(error);
                }
            }
        });

        // --- namelist.wps download ----------------------------------------------
        // reuses the existing WPS pipeline: the namelist is read back from the
        // domain currently shown in the Domains panel, so manual fine-tuning
        // (resized/moved nests, dx changes, ...) is reflected in the download
        buttonSaveNamelistWps.addEventListener('click', () => {
            const ns = this._currentWPSNamelist();
            if (!ns) {
                return;
            }
            saveAs(
                new Blob([ns.toString()], { type: 'text/plain;charset=utf-8' }),
                'namelist.wps');
        });

        // --- namelist.input download -------------------------------------------
        buttonSaveNamelistInput.addEventListener('click', () => {
            const layout = this._currentLayout();
            if (!layout) {
                return;
            }
            const content = generateVortexFollowingNamelistInput(layout, {
                vortexInterval: parseInt(inputVortexInterval.value, 10) || 15,
                maxVortexSpeed: parseInt(inputMaxVortexSpeed.value, 10) || 40,
                corralDist: parseInt(inputCorralDist.value, 10) || 8
            });
            saveAs(
                new Blob([content], { type: 'text/plain;charset=utf-8' }),
                'namelist.input');
        });
    }

    /**
     * Current WPS namelist: the (possibly hand-edited) domain from the
     * Domains panel when available, otherwise the last computed layout.
     * Simulation dates are taken from the TC panel.
     * @returns {WPSNamelist|null}
     */
    _currentWPSNamelist() {
        let ns = this.sidebarDomains.getNamelist();
        if (!ns && this.layout) {
            ns = createWPSNamelist(this.layout);
        }
        if (!ns) {
            return null;
        }
        const start = this._readTime(this._controls.inputStart);
        const end = this._readTime(this._controls.inputEnd);
        if (start && end) {
            const startDate = formatWpsDate(start);
            const endDate = formatWpsDate(end);
            ns.share.start_date = Array.from({ length: ns.share.max_dom }, () => startDate);
            ns.share.end_date = Array.from({ length: ns.share.max_dom }, () => endDate);
            ns.share.interval_seconds = ns.share.interval_seconds || 21600;
        }
        return ns;
    }

    /**
     * Current TC layout, rebuilt from the live Domains panel state when
     * available so namelist.input matches namelist.wps.
     */
    _currentLayout() {
        const ns = this.sidebarDomains.getNamelist();
        const start = this._readTime(this._controls.inputStart);
        const end = this._readTime(this._controls.inputEnd);
        if (ns && start && end) {
            return layoutFromWPSNamelist(ns, start, end);
        }
        return this.layout;
    }

    // load a GeoJSON track string and display it
    _loadTrack(text) {

        this._removeTrack();

        const units = this.container.querySelector('#tc-wind-units').value;
        const layer = new StormTrackLayer(text, { windUnits: units });

        layer.on('stormtrack:settime', (e) => {
            const input = (e.type === 'start') ?
                this._controls.inputStart :
                this._controls.inputEnd;
            input.value = SidebarTropicalCyclone._toInputValue(e.time);
            this._updateTrackWindow();
        });

        layer.addTo(this.map);
        this.map.fitBounds(layer.getBounds(), { paddingTopLeft: [400, 20], paddingBottomRight: [20, 20] });

        this.trackLayer = layer;

        // populate the panel
        const range = layer.getTimeRange();
        this._controls.stormName.textContent = layer.getStormName();
        this._controls.stormPeriod.textContent =
            `${formatWpsDate(range.start).replace('_', ' ')} - ${formatWpsDate(range.end).replace('_', ' ')} UTC, ` +
            `${layer.getPoints().length} fixes`;

        // default simulation window: full track
        this._controls.inputStart.value = SidebarTropicalCyclone._toInputValue(range.start);
        this._controls.inputEnd.value = SidebarTropicalCyclone._toInputValue(range.end);

        this._controls.trackInfo.style.display = '';
        this._controls.form.style.display = '';
        this._controls.buttonRemove.disabled = false;

        this._updateTrackWindow();
    }

    _removeTrack() {
        if (this.trackLayer) {
            this.trackLayer.remove();
            this.trackLayer = null;
        }
        this.layout = null;
        this._controls.trackInfo.style.display = 'none';
        this._controls.form.style.display = 'none';
        this._controls.buttonRemove.disabled = true;
        this._controls.buttonSaveNamelistInput.disabled = true;
        this._controls.buttonSaveNamelistWps.disabled = true;
        this._controls.divSummary.style.display = 'none';
        this._controls.divWarnings.innerHTML = '';
    }

    _updateTrackWindow() {
        if (!this.trackLayer) {
            return;
        }
        const start = this._readTime(this._controls.inputStart);
        const end = this._readTime(this._controls.inputEnd);
        this.trackLayer.setWindow(start, end);
    }

    // datetime-local value -> Date (UTC)
    _readTime(input) {
        if (!input.value) {
            return null;
        }
        return parseTrackTime(input.value);
    }

    static _toInputValue(date) {
        return date.toISOString().slice(0, 16);
    }

    _renderNestSizeInputs() {
        const maxDom = parseInt(this._controls.selectMaxDom.value, 10);
        const defaults = [1000, 550, 300, 170];
        const container = this._controls.containerNestSizes;

        // keep previously entered values
        const previous = this._readNestSizes();

        let html = '';
        for (let k = 0; k < maxDom - 1; k++) {
            const value = (previous && previous[k]) ? previous[k] : defaults[Math.min(k, defaults.length - 1)];
            html +=
                `<div class="input-group input-group-sm">` +
                `<div class="input-group-prepend">` +
                `<span class="input-group-text" style="width: 139px" title="Width and height of domain d${String(k + 2).padStart(2, '0')} in kilometers">d${String(k + 2).padStart(2, '0')} size (km)</span>` +
                `</div>` +
                `<input data-nest-size="${k}" type="number" class="form-control" required min="10" value="${value}">` +
                `<div class="invalid-feedback">Enter the nest size in km</div>` +
                `</div>`;
        }
        container.innerHTML = html;
    }

    _readNestSizes() {
        const inputs = this._controls.containerNestSizes.querySelectorAll('input[data-nest-size]');
        if (inputs.length === 0) {
            return null;
        }
        const sizes = [];
        inputs.forEach((input) => {
            sizes[parseInt(input.dataset.nestSize, 10)] = parseFloat(input.value);
        });
        return sizes;
    }

    _showSummary(layout) {
        const div = this._controls.divSummary;
        let html = '<table class="table table-sm tc-summary-table"><thead>' +
            '<tr><th></th><th>dx (km)</th><th>e_we</th><th>e_sn</th><th>i,j start</th></tr></thead><tbody>';
        for (const d of layout.domains) {
            html += `<tr><td>d${String(d.id).padStart(2, '0')}${d.id > 1 ? ' <i class="fas fa-location-arrow tc-moving-icon" title="moving nest"></i>' : ''}</td>` +
                `<td>${(d.dx / 1000).toFixed(d.dx % 1000 === 0 ? 0 : 2)}</td>` +
                `<td>${d.e_we}</td><td>${d.e_sn}</td>` +
                `<td>${d.i_parent_start}, ${d.j_parent_start}</td></tr>`;
        }
        html += '</tbody></table>';
        html += `<div class="text-muted small">closest d02 approach to d01 boundary: ${layout.minEdgeCells.toFixed(1)} cells</div>`;
        div.innerHTML = html;
        div.style.display = '';
    }

    _showWarnings(warnings) {
        const div = this._controls.divWarnings;
        div.innerHTML = '';
        for (const warning of warnings) {
            const alert = document.createElement('div');
            alert.className = 'alert alert-warning alert-sm';
            alert.setAttribute('role', 'alert');
            alert.textContent = warning;
            div.appendChild(alert);
        }
    }
}

export function sidebarTropicalCyclone(map, sidebar, sidebarDomains) {
    return new SidebarTropicalCyclone(map, sidebar, sidebarDomains);
}
