import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express, { Router } from 'express';
import request from 'supertest';
import { createApp } from './createApp';

/**
 * Serving order is load-bearing, and these tests exist because getting it wrong
 * fails in a way that looks like a client bug.
 *
 * `/api/*` must be matched FIRST, then static files, and the SPA fallback must
 * answer only HTML GETs. A catch-all fallback turns an unmatched `/api/...` into
 * a 200 with an HTML body — and with a service worker in front, the worker may
 * then cache that HTML AS an API response, so the app keeps serving a page where
 * it expects JSON until someone clears storage on the phone.
 */

let clientDist: string;

beforeAll(() => {
  clientDist = mkdtempSync(join(tmpdir(), 'house-heating-client-'));
  writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>SpyD Home Heat</title>');
  mkdirSync(join(clientDist, 'assets'));
  writeFileSync(join(clientDist, 'assets', 'app-abc123.js'), 'console.log("built asset");');
  writeFileSync(join(clientDist, 'sw.js'), '// service worker');
});

afterAll(() => {
  rmSync(clientDist, { recursive: true, force: true });
});

function testApp() {
  const fills = Router();
  fills.get('/', (_req, res) => {
    res.json([{ id: 1 }]);
  });

  return createApp({
    clientDistPath: clientDist,
    routers: { fills },
  });
}

describe('createApp', () => {
  describe('API routes come first', () => {
    it('serves a mounted API route as JSON', async () => {
      const response = await request(testApp()).get('/api/fills');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 1 }]);
    });

    it('answers the health check', async () => {
      const response = await request(testApp()).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    /**
     * THE CENTRAL TEST. An unmatched /api path must be a JSON 404, never the
     * SPA shell. If this regresses, the service worker can cache HTML as an API
     * response and the failure outlives the deploy that caused it.
     */
    it('returns a JSON 404 for an unmatched /api path, never the SPA shell', async () => {
      const response = await request(testApp())
        .get('/api/does-not-exist')
        .set('Accept', 'text/html');

      expect(response.status).toBe(404);
      expect(response.type).toMatch(/json/);
      expect(response.text).not.toMatch(/<!doctype html>/i);
    });

    it('returns a JSON 404 for an unmatched /api path even under a known router prefix', async () => {
      const response = await request(testApp()).get('/api/fills/nope/deeper');

      expect(response.status).toBe(404);
      expect(response.type).toMatch(/json/);
    });
  });

  describe('static assets', () => {
    it('serves a built asset', async () => {
      const response = await request(testApp()).get('/assets/app-abc123.js');

      expect(response.status).toBe(200);
      expect(response.text).toContain('built asset');
    });

    it('serves the service worker from the site root so its scope is /', async () => {
      const response = await request(testApp()).get('/sw.js');

      expect(response.status).toBe(200);
      expect(response.text).toContain('service worker');
    });

    /**
     * A missing asset must 404, not fall back to index.html. Returning the HTML
     * shell for a missing .js makes the browser parse HTML as a script, which
     * reports as a syntax error pointing at a file that is fine.
     */
    it('404s a missing asset rather than falling back to the SPA shell', async () => {
      const response = await request(testApp()).get('/assets/deleted-by-a-deploy.js');

      expect(response.status).toBe(404);
      expect(response.text).not.toMatch(/<!doctype html>/i);
    });
  });

  describe('SPA fallback', () => {
    it('serves the shell at the root', async () => {
      const response = await request(testApp()).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/<!doctype html>/i);
    });

    it('serves the shell for a client-side route so a deep link works', async () => {
      const response = await request(testApp())
        .get('/fills/new')
        .set('Accept', 'text/html');

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/<!doctype html>/i);
    });

    it('does not answer a non-GET with the shell', async () => {
      const response = await request(testApp()).post('/fills/new');

      expect(response.status).toBe(404);
      expect(response.text).not.toMatch(/<!doctype html>/i);
    });

    it('does not answer a request that does not accept HTML with the shell', async () => {
      const response = await request(testApp())
        .get('/fills/new')
        .set('Accept', 'application/json');

      expect(response.status).toBe(404);
      expect(response.text).not.toMatch(/<!doctype html>/i);
    });
  });
});
