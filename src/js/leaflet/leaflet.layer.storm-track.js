import { parseStormTrack, saffirSimpson, trackPositionAt, SaffirSimpsonCategories, WindUnits, formatWpsDate } from "../utils/tc";

/**
 * Leaflet layer displaying a tropical cyclone track from a GeoJSON file.
 *
 * Track points are rendered as circle markers colored by Saffir-Simpson
 * category. Clicking a point opens a popup that allows the user to use the
 * point's time as the simulation start or end time. The layer fires:
 *
 *   'stormtrack:settime'  { type: 'start'|'end', time: Date }
 *
 * A Saffir-Simpson legend control is added to the map with the layer.
 */
export var StormTrackLayer = L.FeatureGroup.extend({

    options: {
        windUnits: 'ms',
        lineColor: '#666666',
        radius: 6
    },

    initialize: function (geojson, options) {
        L.Util.setOptions(this, options);
        L.FeatureGroup.prototype.initialize.call(this, []);

        this._points = parseStormTrack(geojson);
        this._markers = [];
        this._window = { start: null, end: null };
        this._legend = null;

        this._build();
    },

    onAdd: function (map) {
        L.FeatureGroup.prototype.onAdd.call(this, map);
        this._addLegend(map);
    },

    onRemove: function (map) {
        this._removeLegend();
        L.FeatureGroup.prototype.onRemove.call(this, map);
    },

    get points() {
        return this._points;
    },

    getPoints: function () {
        return this._points;
    },

    getStormName: function () {
        const named = this._points.find(p => p.name);
        return named ? named.name : 'STORM';
    },

    getTimeRange: function () {
        return {
            start: this._points[0].time,
            end: this._points[this._points.length - 1].time
        };
    },

    positionAt: function (time) {
        return trackPositionAt(this._points, time);
    },

    setWindUnits: function (units) {
        if (WindUnits[units]) {
            this.options.windUnits = units;
            this._restyle();
            this._updateLegend();
        }
    },

    /**
     * Highlight the selected simulation window. Points outside [start, end]
     * are faded.
     */
    setWindow: function (start, end) {
        this._window.start = start || null;
        this._window.end = end || null;
        this._restyle();
    },

    _category: function (point) {
        if (point.vmax === null || point.vmax === undefined || isNaN(point.vmax)) {
            return null;
        }
        return saffirSimpson(point.vmax, this.options.windUnits);
    },

    _inWindow: function (point) {
        if (this._window.start !== null && point.time < this._window.start) {
            return false;
        }
        if (this._window.end !== null && point.time > this._window.end) {
            return false;
        }
        return true;
    },

    _markerStyle: function (point) {
        const category = this._category(point);
        const inWindow = this._inWindow(point);
        return {
            className: 'storm-track-point',
            radius: this.options.radius,
            color: '#333333',
            weight: 1,
            opacity: inWindow ? 1.0 : 0.25,
            fillColor: category ? category.color : '#bbbbbb',
            fillOpacity: inWindow ? 0.95 : 0.2
        };
    },

    _popupContent: function (point) {
        const category = this._category(point);
        const units = WindUnits[this.options.windUnits].label;
        const timeString = formatWpsDate(point.time);

        let html = '<div class="storm-track-popup">';
        html += `<table class="storm-track-popup-table">`;
        if (point.name) {
            html += `<tr><th colspan="2">${point.name}</th></tr>`;
        }
        html += `<tr><td>time</td><td>${timeString.replace('_', ' ')} UTC</td></tr>`;
        if (category) {
            html += `<tr><td>category</td><td><span class="storm-track-cat" style="background:${category.color}">${category.short}</span> ${category.label}</td></tr>`;
        }
        if (point.vmax !== null && point.vmax !== undefined) {
            html += `<tr><td>vmax</td><td>${Number(point.vmax).toFixed(1)} ${units}</td></tr>`;
        }
        if (point.mslp !== null && point.mslp !== undefined) {
            html += `<tr><td>mslp</td><td>${point.mslp} hPa</td></tr>`;
        }
        html += '</table>';
        html += `<div class="storm-track-popup-buttons">`;
        html += `<button type="button" class="btn btn-sm btn-outline-primary" data-action="set-start" data-time="${point.time.getTime()}">Set as start</button> `;
        html += `<button type="button" class="btn btn-sm btn-outline-primary" data-action="set-end" data-time="${point.time.getTime()}">Set as end</button>`;
        html += '</div></div>';
        return html;
    },

    _build: function () {

        // track line
        this._line = L.polyline(this._points.map(p => [p.lat, p.lon]), {
            color: this.options.lineColor,
            weight: 2,
            opacity: 0.8,
            dashArray: '4 4'
        });
        this.addLayer(this._line);

        // point markers
        for (const point of this._points) {
            const marker = L.circleMarker([point.lat, point.lon], this._markerStyle(point));
            marker._stormPoint = point;

            marker.bindPopup(() => this._popupContent(point), { minWidth: 220 });
            marker.on('popupopen', (e) => {
                const container = e.popup.getElement();
                container.querySelectorAll('button[data-action]').forEach((button) => {
                    button.addEventListener('click', (clickEvent) => {
                        const action = clickEvent.currentTarget.dataset.action;
                        const time = new Date(parseInt(clickEvent.currentTarget.dataset.time, 10));
                        this.fire('stormtrack:settime', {
                            type: action === 'set-start' ? 'start' : 'end',
                            time: time
                        });
                        marker.closePopup();
                    });
                });
            });

            const category = this._category(point);
            const tooltip = `${point.name || ''} ${formatWpsDate(point.time).replace('_', ' ')}` +
                (category ? ` &mdash; ${category.short}` : '');
            marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -6] });

            this._markers.push(marker);
            this.addLayer(marker);
        }
    },

    _restyle: function () {
        for (const marker of this._markers) {
            marker.setStyle(this._markerStyle(marker._stormPoint));
        }
    },

    _addLegend: function (map) {
        if (this._legend) {
            return;
        }
        const self = this;
        const LegendControl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd: function () {
                const div = L.DomUtil.create('div', 'storm-track-legend leaflet-bar');
                div.innerHTML = self._legendContent();
                return div;
            }
        });
        this._legend = new LegendControl();
        this._legend.addTo(map);
    },

    _legendContent: function () {
        let html = `<div class="storm-track-legend-title">Saffir-Simpson</div>`;
        for (const category of SaffirSimpsonCategories) {
            html += `<div class="storm-track-legend-row">` +
                `<span class="storm-track-legend-swatch" style="background:${category.color}"></span>` +
                `<span>${category.label}</span></div>`;
        }
        return html;
    },

    _updateLegend: function () {
        if (this._legend && this._legend.getContainer()) {
            this._legend.getContainer().innerHTML = this._legendContent();
        }
    },

    _removeLegend: function () {
        if (this._legend) {
            this._legend.remove();
            this._legend = null;
        }
    }
});

export function stormTrackLayer(geojson, options) {
    return new StormTrackLayer(geojson, options);
}
