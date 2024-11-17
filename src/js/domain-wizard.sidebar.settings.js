import { GeographicLines } from "./leaflet/leaflet.layer.geographic-lines";
import { AutoGraticule } from "./leaflet/leaflet.layer.graticule";

export var SidebarSettings = L.Class.extend({

    _map: null,
    _container: null,

    _controls: {},
    _graticule: null,
    _geographicLines: null,

    initialize: function (map, sidebar, appSettings) {

        this._map = map;
        this._container = sidebar.getContainer().querySelector('#settings');
        this._appSettings = appSettings;

        this._graticule = new AutoGraticule({
            verticalLabelOffset: 480
        });

        this._geographicLines = new GeographicLines({});
        this._addEventListeners();
        this._setControlValues();

        this._container.querySelector('button#reset-settings').addEventListener('click', (e) => {
            this._appSettings.reset();
            this._setControlValues();
        });
    },

    _addEventListeners: function() {
        for (const key of this._appSettings.keys()) {
            const control = this._container.querySelector(`input[name="${key}"]`);
            if (control) {
                this._controls[key] = control;

                if (control.tagName === "INPUT") {

                    switch(control.type) {
                        case 'checkbox':
                            control.addEventListener('click', (e) => {
                                this._appSettings.set(key, e.currentTarget.checked);
                            });
                            break;
                        case 'number':
                            control.addEventListener('change', (e) => {
                                this._appSettings.set(key, control.value);
                            });
                            break;
                        case 'text':
                            control.addEventListener('change', (e) => {
                                this._appSettings.set(key, control.value);
                            });
                            break;
                    }
                }
            }
        }

        if ('showGraticule' in this._controls) {
            this._controls['showGraticule'].addEventListener('click', (e) => {
                this._showGraticule(e.currentTarget.checked);
            });
        }

        if ('showGeographicLines' in this._controls) {
            this._controls['showGeographicLines'].addEventListener('click', (e) => {
                this._showGeographicLines(e.currentTarget.checked);
            });
        }
    },

    _setControlValues: function(){
        for (const key in this._controls) {
            const control = this._controls[key];
            const value = this._appSettings.get(key);
                
            switch(control.type) {
                case 'checkbox':
                    control.checked = value === true;
                    control.addEventListener('click', (e) => {
                        this._appSettings.set(key, e.currentTarget.checked);
                    });
                    break;
                case 'number':
                    control.value = value;
                    control.addEventListener('change', (e) => {
                        this._appSettings.set(key, control.value);
                    });
                    break;
                case 'text':
                    control.value = value;
                    control.addEventListener('change', (e) => {
                        this._appSettings.set(key, control.value);
                    });
                    break;
            }
        }

        if ('showGraticule' in this._controls) {
            this._showGraticule(this._appSettings.get('showGraticule'));
        }

        if ('showGeographicLines' in this._controls) {
            this._showGeographicLines(this._appSettings.get('showGeographicLines'));
        }
    },

    _showGraticule: function(show) {
        if (show === true) {
            this._graticule.addTo(this._map);
        } else {
            this._graticule.remove();
        }
    },

    _showGeographicLines: function(show) {
        if (show === true) {
            this._geographicLines.addTo(this._map);
        } else {
            this._geographicLines.remove();
        }
    }
});

export function sidebarSettings(map, sidebar, appSettings) {
    return new SidebarSettings(map, sidebar, appSettings);
}