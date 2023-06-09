// test values

const {DateTime} = require("luxon");

let ranges3_ISO = [
  [null, '2000-01-01T00:00:00'],

  [ '2000-01-01T18:00:00', '2000-01-02T06:00:00' ],
  [ '2000-01-02T18:00:00', '2000-01-03T06:00:00' ],
  [ '2000-01-03T18:00:00', '2000-01-04T06:00:00' ],

  [ '2000-02-01T05:00:00', '2000-02-01T06:00:00' ],
  [ '2000-02-01T07:00:00', '2000-02-01T08:00:00' ],



  [ '2000-02-02T05:00:00', '2000-02-02T06:00:00' ],
  [ '2000-02-02T07:00:00', '2000-02-02T08:00:00' ],

  [ '2000-02-03T05:00:00', '2000-02-03T06:00:00' ],
  [ '2000-02-03T07:00:00', '2000-02-03T08:00:00' ],

  [ '2000-02-04T05:00:00', '2000-02-04T06:00:00' ],

  [ '2000-02-05T05:00:00', '2000-02-05T06:00:00' ],
  [ '2000-02-05T07:00:00', '2000-02-05T08:00:00' ],



  [ '2000-03-01T08:00:00', '2000-04-01T08:00:00'],
  [ '2000-05-01T08:00:00', null ]
];

let ranges3 = ranges3_ISO.map(r => r.map(s => s ? DateTime.fromISO(s).toSeconds() : 0))