import * as mapboxgl from 'mapbox-gl';
import * as React from "react";
import { BoundingBox, JsDict, RouteChange, StopForMap } from '../data';
import { LoadingOverlay } from '../AlertViews/AlertListPage';

const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiaXNoMCIsImEiOiJja3h3aW90N2Ixd3B1MnNtcHRxMnBkdTBjIn0.IDeZtjeHSZmEXyD3o7p6ww';

function newShapesForChange(change: RouteChange, stops: JsDict<StopForMap>) {
    const newStopidLists = [];

    let currentNewStopidList = [];

    for (let i = 0; i < change.updated_stop_sequence.length; i++) {
        const [stop_id, is_added] = change.updated_stop_sequence[i];

        if (is_added) {
            if (currentNewStopidList.length) {
                currentNewStopidList.push(stop_id);
            } else {
                if (i > 0) {
                    currentNewStopidList.push(
                        change.updated_stop_sequence[i - 1][0]
                    );
                }

                currentNewStopidList.push(stop_id);
            }
        } else {
            if (currentNewStopidList.length) {
                currentNewStopidList.push(stop_id);
                newStopidLists.push(currentNewStopidList);
                currentNewStopidList = [];
            }
        }
    }

    // clean up any she'erit hapleyta
    if (currentNewStopidList.length) {
        newStopidLists.push(currentNewStopidList);
    }

    return newStopidLists.map(
        stopidList => stopidList.map(
            stop_id => [stops[stop_id].stop_lon, stops[stop_id].stop_lat]
        )
    );
}

const SOURCE_TRIP_SHAPE = 'trip-shape';
const SOURCE_NON_REMOVED_STOPS = 'non-removed-stops';
const SOURCE_REMOVED_STOPS = 'removed-stops';
const SOURCE_NEW_SHAPES = 'new-shapes';

const LAYER_REMOVED_STOPS_X = 'removed-stops-x';

const ALL_LAYERS = [
    SOURCE_TRIP_SHAPE, 
    SOURCE_NON_REMOVED_STOPS,
    SOURCE_REMOVED_STOPS,
    SOURCE_NEW_SHAPES,
    LAYER_REMOVED_STOPS_X
];

const IMAGE_ICON_X = 'map-x';

function convertSingleChangeToMapData(
    selector: string,
    change: RouteChange,
    stops: JsDict<StopForMap>
): JsDict<any[]> {
    const newShapes = newShapesForChange(change, stops);

    return {
        [SOURCE_TRIP_SHAPE]: [{
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": change.shape
            },
            "properties": {
                "selector": selector
            }
        }],
        [SOURCE_NON_REMOVED_STOPS]:
            change.updated_stop_sequence.map(([stop_id, is_added]) => ({
                "type": "Feature",
                "properties": {
                    "selector": selector
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        stops[stop_id].stop_lon,
                        stops[stop_id].stop_lat
                    ]
                }
            })),
        [SOURCE_REMOVED_STOPS]:
            change.deleted_stop_ids.map(stop_id => ({
                "type": "Feature",
                "properties": {
                    "selector": selector
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        stops[stop_id].stop_lon,
                        stops[stop_id].stop_lat
                    ]
                }
            })),
        [SOURCE_NEW_SHAPES]: [{
            "type": "Feature",
            "geometry": {
                "type": "MultiLineString",
                "coordinates": newShapes
            },
            "properties": {
                "selector": selector
            }
        }]
    };
}

function stringForSelection(agency_id: string, line_number: string, i: number) {
    return `${agency_id}__${line_number}__${i}__`;
}

function convertChangesToMapData(
    initialSelection: [string, string, number],
    route_changes: JsDict<JsDict<RouteChange[]>>,
    map: mapboxgl.Map,
    stops: JsDict<StopForMap>,
    xImage: HTMLImageElement | ImageBitmap
) {
    const mapData: JsDict<any> = {
        [SOURCE_TRIP_SHAPE]: [],
        [SOURCE_NON_REMOVED_STOPS]: [],
        [SOURCE_REMOVED_STOPS]: [],
        [SOURCE_NEW_SHAPES]: []
    };

    for (const agency_id of Object.keys(route_changes)) {
        for (const line_number of Object.keys(route_changes[agency_id])) {
            for (let i = 0; i < route_changes[agency_id][line_number].length; i++) {
                const newValues = convertSingleChangeToMapData(
                    stringForSelection(agency_id, line_number, i),
                    route_changes[agency_id][line_number][i],
                    stops
                );

                for (const key of Object.keys(mapData)) {
                    mapData[key] = mapData[key].concat(newValues[key]);
                }
            }
        }
    }

    console.log(mapData);

    map.addSource(SOURCE_TRIP_SHAPE, {
        "type": "geojson",
        "data": {
            "type": "FeatureCollection",
            "features": mapData[SOURCE_TRIP_SHAPE]
        }
    });

    map.addSource(SOURCE_NON_REMOVED_STOPS, {
        "type": "geojson",
        "data": {
            "type": "FeatureCollection",
            "features": mapData[SOURCE_NON_REMOVED_STOPS]
        }
    });

    map.addSource(SOURCE_REMOVED_STOPS, {
        "type": "geojson",
        "data": {
            "type": "FeatureCollection",
            "features": mapData[SOURCE_REMOVED_STOPS]
        }
    });

    map.addSource(SOURCE_NEW_SHAPES, {
        "type": "geojson",
        "data": {
            "type": "FeatureCollection",
            "features": mapData[SOURCE_NEW_SHAPES]
        }
    });

    const initialSelector = stringForSelection(...initialSelection);

    map.addLayer({
        "id": SOURCE_NEW_SHAPES,
        "source": SOURCE_NEW_SHAPES,
        "type": "line",
        "paint": {
            "line-color": "#000", // TODO
            "line-width": 3, // TODO?,
            "line-dasharray": [2, 2] 
        },
        "filter": ["==", "selector", initialSelector]
    });

    map.addLayer({
        "id": SOURCE_TRIP_SHAPE,
        "source": SOURCE_TRIP_SHAPE,
        "type": "line",
        "paint": {
            "line-color": "#000", // TODO
            "line-width": 3 // TODO?
        },
        "filter": ["==", "selector", initialSelector]
    });

    map.addLayer({
        "id": SOURCE_NON_REMOVED_STOPS,
        "source": SOURCE_NON_REMOVED_STOPS,
        "type": "circle",

        "paint": {
            "circle-color": "#fff",
            "circle-radius": 3,
            "circle-stroke-color": "#000", // TODO
            "circle-stroke-width": 2
        },
        "filter": ["==", "selector", initialSelector]
    });

    map.addLayer({
        "id": SOURCE_REMOVED_STOPS,
        "source": SOURCE_REMOVED_STOPS,
        "type": "circle",

        "paint": {
            "circle-color": "#fff",
            "circle-radius": 3,
            "circle-stroke-color": "#000", // TODO
            "circle-stroke-width": 2
        },
        "filter": ["==", "selector", initialSelector]
    });

    map.addImage(IMAGE_ICON_X, xImage);
    map.addLayer({
        "id": LAYER_REMOVED_STOPS_X,
        "source": SOURCE_REMOVED_STOPS,
        "type": "symbol",
        "layout": {
            "icon-image": IMAGE_ICON_X,
            "icon-allow-overlap": true
        },
        "filter": ["==", "selector", initialSelector]
    });
}

function setLayerFilters(
    layers: string[],
    selector: string,
    map: mapboxgl.Map
) {
    for (const l of layers) {
        const layer = map.getLayer(l);

        if (layer) {
            map.setFilter(l, ["==", "selector", selector]);
        }
    }
}

export interface RouteChangesMapViewProps {
    route_changes: JsDict<JsDict<RouteChange[]>>,
    stops: JsDict<StopForMap>,
    selection: [string, string, number];
    map_bounding_box: BoundingBox;
}

const FIT_BOUNDS_OPTIONS = {
    padding: {
        top: 40,
        bottom: 40,
        right: 40,
        left: 40
    },
    maxZoom: 15,
};

export const RouteChangesMapView = ({route_changes, stops, selection, map_bounding_box}: RouteChangesMapViewProps) => {
    const mapContainer = React.useRef<HTMLDivElement>(null);
    const map = React.useRef<mapboxgl.Map>(null);
    const previousSelection = React.useRef<[string, string, number]>(selection);

    const [isLoading, setIsLoading] = React.useState<boolean>(!!route_changes);
    const [isLookingAtBbox, setIsLookingAtBbox] = React.useState<boolean>(true);

    const bbox = React.useMemo<[[number, number], [number, number]]>(
        () => !map_bounding_box ? null : [
            [map_bounding_box.min_lon, map_bounding_box.min_lat],
            [map_bounding_box.max_lon, map_bounding_box.max_lat]
        ],
        [map_bounding_box]
    );

    React.useEffect(() => {
        if (!route_changes || !stops) {
            if (!isLoading) {
                setIsLoading(true);
            }
            return;
        }

        if (map.current) {
            return;
        }
        
        if (!(window as any).rtl_plugin_was_set) {
            mapboxgl.setRTLTextPlugin('https://cdn.maptiler.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js', ()=>{}, true);
            (window as any).rtl_plugin_was_set = true;
        }
        map.current = new mapboxgl.Map({
            accessToken: MAPBOX_ACCESS_TOKEN,
            container: mapContainer.current,
            style: 'https://api.maptiler.com/maps/893ed6e5-f439-431b-a9a6-885c01fa3e48/style.json?key=XQ643Hu2aW2ClNCu8gL4',
            bounds: bbox,
            fitBoundsOptions: FIT_BOUNDS_OPTIONS
        });

        map.current.on('move', () => {
            const bounds = map.current.getBounds();

            setIsLookingAtBbox(
                bounds.contains(bbox[0]) && bounds.contains(bbox[1])
            );
        })

        map.current.on('load', () => {
            // in case you wondered how to use an svg as a symbol on a vector map
            // the answer is to turn it into a bitmap
            // enjoy the following monstrosity:
            const mapXBlob = new Blob([
                '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">' +
                    '<rect x="0" y="40" width="100" height="20" fill="#cc2f2f" transform="rotate(45 50 50)" />' +
                    '<rect x="0" y="40" width="100" height="20" fill="#cc2f2f" transform="rotate(-45 50 50)" />' +
                '</svg>'
            ], {type: 'image/svg+xml'});
            const mapXBlobUrl = URL.createObjectURL(mapXBlob);
            const mapXImage = new Image(20, 20);
            mapXImage.onload = () => {
                URL.revokeObjectURL(mapXBlobUrl);

                convertChangesToMapData(
                    previousSelection.current,
                    route_changes,
                    map.current,
                    stops,
                    mapXImage
                );

                setIsLoading(false);
            };
            mapXImage.src = mapXBlobUrl;           
        });

        return () => { // <-- this pattern is so cursed wow
                       //     (tho tbf the entire react hooks pattern kinda is?)
            map.current.remove();
            map.current = null;
        };
    }, [route_changes, stops, map_bounding_box]);

    React.useEffect(() => {
        if (!map.current) {
            return;
        }

        previousSelection.current = selection;
        setLayerFilters(
            ALL_LAYERS,
            stringForSelection(...selection),
            map.current
        );
    }, selection)

    const goBackToChanges = React.useCallback(() => {
        if(map.current) {
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            
            map.current.fitBounds(
                bbox,
                {
                    ...FIT_BOUNDS_OPTIONS,
                    animate: !reduceMotion
                }
            );
        }
    }, [bbox, map]);

    if (!route_changes) {
        return <div className="map-container-container before-loading"></div>;
    }

    return <div className="map-container-container">
        <button className={"back-to-changes" + (isLookingAtBbox ? " hidden" : "")}
                onClick={goBackToChanges}>
            לחצו לחזרה לאזור השינויים
        </button>
        <div className={"map-container"} ref={mapContainer}></div>
        <LoadingOverlay shown={isLoading} textOverride="מפה בטעינה..." />
    </div>;
};
