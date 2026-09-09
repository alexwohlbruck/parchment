

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
- **API docs**: https://docs.parchment.app/docs/api  

## Documentation

Full documentation (getting started, environment, self-hosting, development, testing, and more) is at **https://docs.parchment.app**.

To run the docs locally:

```bash
cd docs && bun run dev
```

Then open **http://localhost:3001/docs** (live site: **https://docs.parchment.app**).

## License

Parchment is source-available under the **Apache License 2.0 with the Commons Clause** — see [LICENSE](LICENSE).

In short: **free to self-host and use, including inside your business — but you may not sell it.** You can run it for yourself, your friends, or your company's internal use; fork it; and contribute back. You may not resell it, or host it as a paid service, where the value comes substantially from Parchment. See [LICENSING.md](LICENSING.md) for a plain-language explanation with examples.

