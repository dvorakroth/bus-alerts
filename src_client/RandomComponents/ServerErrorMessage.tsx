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

export const ServerErrorChangesMessage = () => <>
    <div className="no-alerts-today error-loading-changes">
        <span>כאן אמור להופיע עוד מידע</span>
        <span>אבל במקום זה יש שגיאה</span>
        <span className="snarky-comment">
            אפשר לנסות שוב; אולי זה יעזור?
            <br />
            (ואפשר גם
            {" "}
            <a href="mailto:ish@ish.works">לכתוב לי</a>,
            אם השגיאה הזו תחזור)
        </span>
    </div>
</>;
