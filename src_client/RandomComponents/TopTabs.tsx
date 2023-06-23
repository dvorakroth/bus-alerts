import * as React from "react";
import * as ReactRouterDOM from "react-router-dom";

export enum TopTabItem {
    Lines,
    Alerts
}

export interface TopTabsProps {
    selectedItem: TopTabItem
}

export function TopTabs({selectedItem}: TopTabsProps) {
    return <div className="top-tabs" role="navigation">
        {/* TODO make the selected link unclickable? */}
        <ReactRouterDOM.Link role="button" aria-pressed={selectedItem===TopTabItem.Lines} to="/lines">
            קווים
        </ReactRouterDOM.Link>
        <ReactRouterDOM.Link role="button" aria-pressed={selectedItem===TopTabItem.Alerts} to="/alerts">
            התראות
        </ReactRouterDOM.Link>
    </div>;
}