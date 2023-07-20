bus-alerts
==========

See real-time service alerts for Israeli public transit! Visit [bus-alerts.com](https://bus-alerts.com/)

This is a Hebrew-language website/webapp written in Typescript, PostgreSQL, HTML, JSX and SASS, designed to read in GTFS and GTFS-RT data from the Israeli Ministry of Transportation, and hopefully output it in a readable, usable format.

This project was created after the Israeli MoT created [its own weird-ass extensions to the GTFS-RT format](https://www.gov.il/he/departments/general/special_notices_to_developers) that so far no major transit app has implemented any support for.

This project is in the public domain, see [LICENSE](./LICENSE) for more details. Feel free to fork it, extend it, add to it, run your own instance of it, whatever! For the love of friggin' G-d this data needs to be accessible to public transit users!

Found a bug? Have a suggestion?
-------------------------------

If you're a programmer, and have the time and energy, feel free to fork and create a pull request!

If not, you're welcome to create an Issue, or send me an email, or whatever :3

How to use
----------

### Data Sources and Databases

Once you've gotten your secret API key and the endpoint URL for GTFS-RT data from the Ministry, add the complete URL+API key to a config.ini file, as specified in the [example.config.ini](./src_node/example.config.ini)

Additionally, you'll need two PostgreSQL databases: one [for the GTFS data](./scripts/gtfs_schema.sql), and one [for the GTFS-RT data](./scripts/alerts_schema.sql). Add their DSNs to your config.ini as well.

Fetching and loading GTFS data into a PostgreSQL database can be done as illustrated in [gtfs_updater.sh](./scripts/gtfs_updater.sh).

### Compiling the Typescript

The NPM script `npm run build` will build both server-side and client-side code.

### Running the loadServiceAlerts script

To fetch and update GTFS-RT data, run:

```
$ NODE_ENV=production ts-node src_node/loadServiceAlerts.ts -c path/to/config.ini
```

or, if you'd rather run the compiled javascript instead of the raw typescript:

```
$ NODE_ENV=production node dist_node/loadServiceAlerts.js -c path/to/config.ini
```

### Running the web server

To run the web server, run:

```
$ NODE_ENV=production ts-node src_node/webServer.ts -c path/to/config.ini
# OR:
$ NODE_ENV=production node dist_node/webServer.js -c path/to/config
```

If you load new GTFS data (not GTFS-RT, just regular GTFS), you should probably restart the web server process.

### Serving the static content (HTML, JS, CSS, images)

By default, the web server process serves the static data from the `dist` directory, defaulting to `dist/index.html` when a file isn't found, because the client-side code uses React Router to create fake multiple pages.

However, I only use this for development and testing purposes, and I suggest that in production environments, you instead set up an nginx server. Serve static files from the `dist` directory (again, defaulting to sending back `200 OK` with the contents of `dist/index.html` when a file isn't found), and forward all requests to pages whose path starts with `/api/` to the aformentioned [webServer.ts](./src_node/webServer.ts).

Trans rights?
-------------

They're human rights! 🏳️‍⚧️🏳️‍🌈