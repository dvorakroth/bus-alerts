import * as React from "react";

export const ServerErrorMessage = () => <>
    <span>בום! טראח!</span>
    <span>האתר התפוצץ!</span>
    <span>האתר נשבר!</span>
    <span className="snarky-comment">
        אולי כדאי לנסות יותר מאוחר?
        <br/>
        (ואפשר גם
        {" "}
        <a href="mailto:ish@ish.works">לכתוב לי</a>,
        אם זה נשאר)
    </span>
</>;
