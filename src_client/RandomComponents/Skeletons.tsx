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
            {/* <li className="line-number skeleton"></li>
            <li className="line-number skeleton"></li> */}
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
