import * as React from "react";
import {render} from "react-dom";
import {
    BrowserRouter, Route, Routes, useLocation, Navigate
} from "react-router-dom";
import SerivceAlertsMainScreen from "./ServiceAlertsMainScreen";
import {FullPageSingleAlert, ModalSingleAlert} from "./SingleAlertView";

if ((navigator as any).standalone) {
    // for applying css only in web apps launched from the ios home screen

    // there's supposed to be a media query that does this, by the way
    // but it just doesn't work! @media (display-mode: standalone) just doesn't happen!
    // instead it's always display-mode: browser! even in standalone web apps!!!!
    // and for the life of me i can't figure out why the heck that is

    // so enjoy this extremely stupid hack:

    document.body.classList.add('standalone');
}

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
