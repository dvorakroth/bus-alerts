import * as React from "react";
import {render} from "react-dom";
import {
    Route, Routes, useLocation, Navigate, BrowserRouter, HashRouter
} from "react-router-dom";
import LineListPage from "./LineViews/LineListPage";
import AlertListPage from "./AlertViews/AlertListPage";
import {FullPageSingleAlert, ModalSingleAlert} from "./AlertViews/SingleAlertView";
import FullPageSingleLineView from "./LineViews/SingleLineView";
import { LocationStateAlert } from "./LocationState";

let isStandalone = false;

if ((navigator as any)?.standalone || matchMedia('(display-mode: standalone)').matches) {
    // for applying css only in web apps launched from the ios home screen

    // while there' a media query that does this (and we do check it to make sure),
    // in reality it just doesn't work! @media (display-mode: standalone) just doesn't happen!
    // instead it's always display-mode: browser! even in standalone progressive web apps!!!!
    // and for the life of me i can't figure out why the heck that is

    // so enjoy this extremely stupid hack

    document.body.classList.add('standalone');
    document.documentElement.style.height = "100vh";

    isStandalone = true;
}

function App() {
    let location = useLocation();

    let state = location.state as LocationStateAlert;

    console.log(state);

    return <>
        <Routes location={state?.backgroundLocation || location}>
            {/* <Route index element={<LineListPage hasModal={!!state?.backgroundLocation} />} /> */}
            <Route index element={<Navigate to="/alerts" replace={true} />}/>
            
            <Route path="/line/:id" element={<FullPageSingleLineView isModal={false} hasModal={!!state?.backgroundLocation} />} />
            <Route path="/lines" element={<LineListPage hasModal={!!state?.backgroundLocation} />} />

            <Route path="/alerts" element={<AlertListPage hasModal={!!state?.backgroundLocation}/>}/>
            <Route path="/alert/:id" element={<FullPageSingleAlert/>}/>

            <Route path="*" element={<Navigate to="/" replace={true} />}/>
        </Routes>
        {
        state?.backgroundLocation
            ? <Routes>
                <Route path="/alert/:id" element={<ModalSingleAlert />} />
                <Route path="/line/:id" element={<FullPageSingleLineView isModal={true} />} />
            </Routes>
            : null
        }
    </>
}

render(
    <React.StrictMode>
        {
            isStandalone
                ? // standalone home screen launched progressive web apps on ios show
                  // an ugly modal browser whenever the location changes, so we have to
                  // pretend it's 2012 and use a hashrouter to not show it
                    <HashRouter>
                        <App/>
                    </HashRouter>
                :
                    <BrowserRouter>
                        <App/>
                    </BrowserRouter>
        }
    </React.StrictMode>,
    document.getElementById("content")
);
