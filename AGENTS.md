# Powerlifting Scoresheet Replay — Agent Guide

This is a dependency-free browser app for following a powerlifting meet video without seeing results ahead of time.

## Before making changes

- Read [PRODUCT_DECISIONS.md](PRODUCT_DECISIONS.md) for product behavior to preserve and ideas deliberately deferred.
- Read [README.md](README.md) for setup, controls, and troubleshooting.
- Keep the default experience simple: opening `index.html` directly must work for current and recent meets without Python, an account, or a build step. Python is optional and only needed for archive search.

## Run and test

- Open `index.html` in a browser with an internet connection.
- For archive search, run `python3 serve.py` (`py -3 serve.py` on Windows) and open `http://127.0.0.1:8000/`. For a manual check, search for `Sheffield 2026-01-31`.
- Run `node --test test-*.cjs` from the repo root. Tests should run offline using fixtures and simulated responses, not send requests to LiftingCast.

## Working in this repo

- Work only in this standalone repo. The default branch is `master`.
- Do not commit, push, or deploy unless explicitly asked.
- Do not include browser network captures (`.har`), credentials, or files from the old `status` workspace.
- Keep product decisions in `PRODUCT_DECISIONS.md` and setup instructions in `README.md`. Update the relevant file when an agreed change affects it.