import * as React from "react";

export function AlertSummarySkeleton() {
    return <div className="alert-summary-wrapper"><div className="alert-summary shimmer">
        <span className="relevant-tag skeleton"></span>
        {/* <span className="last-end-time skeleton"></span> */}
        <div className="skeleton skeleton-h1"></div>
        <div className="skeleton skeleton-h2"></div>
        <div className="agency-tag skeleton"><span></span></div>
        <ul className="relevant-lines skeleton">
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
        </ul>
        <div className="skeleton skeleton-h2"></div>
        <ul className="relevant-stops">
            <li className="skeleton"><span></span></li>
            <li className="skeleton"><span></span></li>
            <li className="skeleton"><span></span></li>
            <li className="skeleton"><span></span></li>
        </ul>
        <span className="more-details skeleton"></span>
    </div></div>;
}

export function LineSummarySkeleton() {
    return <div className="alert-summary-wrapper"><div className="line-summary shimmer">
        <div className="agency-tag skeleton"><span></span></div>
        <div className="destinations">
            <div className="line-number line-number-verybig skeleton"></div>
            <div className="skeleton skeleton-h1"></div>
            <span className="direction-separator skeleton"></span>
            <div className="skeleton skeleton-h1"></div>
        </div>
        <div className="alert-counters">
            <div className="alert-count-big skeleton"></div>
            <div className="alert-count-big skeleton"></div>
        </div>
        <span className="more-details skeleton"></span>
    </div></div>;
}

export function SingleAlertViewSkeleton() {
    return <div className="single-alert-content line-number-big shimmer">
        <span className="relevant-tag skeleton"></span>
        <div className="skeleton skeleton-h1"></div>
        <div className="skeleton skeleton-h2"></div>
        <ul className="active-periods skeleton">
            <li className="skeleton">
                <span></span>
                <ul className="active-hours">
                    <li><span></span></li>
                    <li><span></span></li>
                </ul>
            </li>
            <li className="skeleton">
                <span></span>
                <ul className="active-hours">
                    <li><span></span></li>
                    <li><span></span></li>
                </ul>
            </li>
        </ul>
        <div className="skeleton skeleton-h2"></div>
        <div className="agency-tag skeleton"><span></span></div>
        <ul className="relevant-lines skeleton">
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
        </ul>
    </div>
}

export function LineChooserAndMapSkeleton() {
    return <div className="shimmer">
        <div className="skeleton skeleton-h2"></div>
        <div className="agency-tag skeleton"><span></span></div>
        <ul className="relevant-lines skeleton">
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li>
        </ul>
        <div className="direction-chooser-wrapper">
            <div className="skeleton skeleton-h2"></div>
            <ul className="direction-chooser">
                <li className="skeleton"></li>
                <li className="skeleton"></li>
            </ul>
        </div>
        <div className="skeleton skeleton-map"></div>
    </div>;
}

export function SingleLineViewSkeleton() {
    return <div className="single-line-content shimmer">
        <div className="destinations">
            <div className="line-and-agency">
                <div className="agency-tag skeleton"><span></span></div>
                <div className="line-number line-number-bigger skeleton"></div>
            </div>
            <div className="direction-chooser-wrapper">
                <ul className="direction-chooser">
                    <li className="skeleton"></li>
                    <li className="skeleton"></li>
                </ul>
            </div>
        </div>
        <div className="skeleton skeleton-h2"></div>
        <div className="skeleton skeleton-map"></div>
    </div>
}
