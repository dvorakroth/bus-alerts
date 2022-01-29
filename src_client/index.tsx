import * as React from "react";
import {render} from "react-dom";
import {
    BrowserRouter, Route, Routes, useLocation, Navigate
} from "react-router-dom";
import SerivceAlertsMainScreen from "./ServiceAlertsMainScreen";
import {FullPageSingleAlert, ModalSingleAlert} from "./SingleAlertView";


function App() {
    let location = useLocation();

    let state = location.state as { backgroundLocation?: Location };

    console.log(state);

    return <>
        <Routes location={state?.backgroundLocation || location}>
            <Route index element={<SerivceAlertsMainScreen hasModal={!!state?.backgroundLocation}/>}/>
            <Route path="/alert/:id" element={<FullPageSingleAlert/>}/>
            <Route path="*" element={<Navigate to="/" replace={true} />}/>
        </Routes>
        {
        state?.backgroundLocation
            ? <Routes>
                <Route path="/alert/:id" element={<ModalSingleAlert />} />
            </Routes>
            : null
        }
    </>
}

render(
    <React.StrictMode>
        <BrowserRouter>
            <App/>
        </BrowserRouter>
    </React.StrictMode>,
    document.getElementById("content")
);
