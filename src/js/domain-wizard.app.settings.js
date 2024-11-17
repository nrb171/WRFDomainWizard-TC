export class AppSettings
{
    static _localStorageKey = '_wrf_domain_wizard_settings';
    static _settings = {
        showGraticule: {
            defaultValue: false,
            dataType: 'boolean',
            remember: false
        },
        showGeographicLines : {
            defaultValue: false,
            dataType: 'boolean',
            remember: true
        },
        minGridDistanceMeters: {
            defaultValue: 1,
            dataType: 'int',
            remember: true
        },
        minGridDistanceDegrees: {
            defaultValue: 0,
            dataType: 'float',
            remember: true
        },
        allowDifferentDxDy: {
            defaultValue: false,
            dataType: 'boolean',
            remember: true
        }
    };

    constructor() {
        for (const key in AppSettings._settings) {

            const setting = AppSettings._settings[key];
            setting.value = setting.defaultValue;

            if (setting.remember !== true) {
                continue;
            }

            const value = localStorage.getItem(AppSettings._localStorageKey + `_${key}`);
            if (value) {
                setting.value = this._parseSettingValue(setting, value);
            }
        }

        this._eventHandlers = {
            'change': {}
        };
    }

    _parseSettingValue(setting, value) {
        switch(setting.dataType) {
            case 'boolean':
                return value === 'true';
            case 'int':
                return parseInt(value);
            case 'float':
                return parseFloat(value);
        }

        return value;
    }

    _validateSettings(key) {
        if (!(key in AppSettings._settings)) {
            throw new Error(`Invalid setting name '${key}'`);
        }
    }

    reset() {
        for (const key in AppSettings._settings) {
            const setting = AppSettings._settings[key];
            localStorage.removeItem(AppSettings._localStorageKey + `_${key}`);
            this.set(key, setting.defaultValue);
        }
    }

    keys() {
        return Object.keys(AppSettings._settings);
    }

    get(key) {
        this._validateSettings(key);
        return AppSettings._settings[key].value;
    }

    set(key, value) {

        this._validateSettings(key);

        const setting = AppSettings._settings[key];

        if (typeof(value) === "string") {
            value = this._parseSettingValue(setting, value);
        }

        const oldValue = AppSettings._settings[key].value;
        if (oldValue !== value) {
            AppSettings._settings[key].value = value;
            if (AppSettings._settings[key].remember === true) {
                localStorage.setItem(AppSettings._localStorageKey + `_${key}`, value.toString());
            }

            if (key in this._eventHandlers['change']) {
                this._eventHandlers['change'][key].forEach((handler) => {
                    handler.call(
                        this, 
                        {
                            name: key,
                            value: value,
                            oldValue: oldValue
                        });
                });
            }
        }
    }

    on(eventName, settings, handler) {

        if (!(eventName in this._eventHandlers)) {
            throw new Error(`Unrecognized event name '${eventName}'`);
        }

        settings.forEach((key) => {
            if (key in this._eventHandlers[eventName]) {
                this._eventHandlers[eventName][key].push(handler);
            } else {
                this._eventHandlers[eventName][key] = [ handler ];
            }
        });
    }
}