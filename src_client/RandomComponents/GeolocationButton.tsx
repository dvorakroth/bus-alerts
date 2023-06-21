import * as React from "react";

const GEOLOCATION_STATUS = {
    OFF: 0,
    DENIED: 1,
    UNAVAILABLE: 2,
    TIMEOUT: 3,
    HAS_LOCATION: 4,
    TRYING: 5
};
const LOCATION_LABEL_PREFIX = "🧭 מיקום: ";
const LOCATION_LABEL_STATUS_TEXT = {
    [GEOLOCATION_STATUS.OFF]: "כבוי",
    [GEOLOCATION_STATUS.DENIED]: "אין הרשאה",


    // cause this isn't very descriptive or even useful to 
    // the end user to know????? idk i'll have to test and see
    [GEOLOCATION_STATUS.UNAVAILABLE]: "לא זמין",
    [GEOLOCATION_STATUS.TIMEOUT]: "לא זמין",
    [GEOLOCATION_STATUS.HAS_LOCATION]: "מופעל",
    [GEOLOCATION_STATUS.TRYING]: "..."
};
const LOCATION_LABEL_CLASSES = {
    [GEOLOCATION_STATUS.OFF]: "is-off",
    [GEOLOCATION_STATUS.DENIED]: "is-denied",
    [GEOLOCATION_STATUS.UNAVAILABLE]: "is-unavailable",
    [GEOLOCATION_STATUS.TIMEOUT]: "is-unavailable",
    [GEOLOCATION_STATUS.HAS_LOCATION]: "is-on",
    [GEOLOCATION_STATUS.TRYING]: "is-loading"
};
interface GeolocationButtonProps {
    onNewLocation: (newLocation: GeolocationPosition|null) => void;
}
interface GeolocationButtonState {
    geolocation_status: number;
}
export default class GeolocationButton extends React.Component<GeolocationButtonProps, GeolocationButtonState> {
    constructor(props: GeolocationButtonProps) {
        super(props);

        this.state = {
            geolocation_status: GEOLOCATION_STATUS.OFF
        };
    }

    onClick = () => {
        if (!navigator || !navigator.geolocation) {
            return;
        }

        if (this.state.geolocation_status === GEOLOCATION_STATUS.HAS_LOCATION) {
            // if we already have a location, disable it
            this.setState({
                geolocation_status: GEOLOCATION_STATUS.OFF
            });

            if (this.props.onNewLocation) {
                this.props.onNewLocation(null);
            }

            return;
        }

        this.setState({
            geolocation_status: GEOLOCATION_STATUS.TRYING
        });

        navigator.geolocation.getCurrentPosition(
            (position) => {
                // success callback
                this.setState({
                    geolocation_status: GEOLOCATION_STATUS.HAS_LOCATION
                });
                if (this.props.onNewLocation) {
                    this.props.onNewLocation(position);
                }
            },

            (error) => {
                // error callback
                let new_status = GEOLOCATION_STATUS.UNAVAILABLE;

                switch (error.code) {
                    case GeolocationPositionError.PERMISSION_DENIED:
                        new_status = GEOLOCATION_STATUS.DENIED;
                        break;
                    case GeolocationPositionError.TIMEOUT:
                        new_status = GEOLOCATION_STATUS.TIMEOUT;
                        break;
                }

                this.setState({
                    geolocation_status: new_status
                });
                if (this.props.onNewLocation) {
                    this.props.onNewLocation(null);
                }
            },

            { enableHighAccuracy: true }
        );
    };

    render() {
        return <button
            id="search-by-location"
            className={LOCATION_LABEL_CLASSES[this.state.geolocation_status]}
            onClick={this.onClick}
        >
            {LOCATION_LABEL_PREFIX + LOCATION_LABEL_STATUS_TEXT[this.state.geolocation_status]}
        </button>;
    }
}
