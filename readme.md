

# Parchment Maps

A modern mapping and navigation app based on open data and open source technologies.

## Quick Start

```bash
git clone https://github.com/alexwohlbruck/parchment.git
cd parchment
cp .env.example .env
# Edit .env with your settings (database, server origins, email)
./start.sh dev
```

- **Frontend**: http://localhost:5173  
- **Backend API**: http://localhost:5000  
- **API docs**: http://localhost:5000/docs  

## Documentation

Full documentation (getting started, environment, self-hosting, development, testing, and more) is in the **docs** site.

To run the docs locally:

```bash
cd docs && bun run dev
```

Then open **http://localhost:3001/docs**.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Free to self-host; cannot sell as a service without sharing source.

