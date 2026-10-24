import * as gemini from '../server/gemini';
import { createEdgeHandler } from '../server/edge-handler';

Deno.serve(createEdgeHandler(gemini, (Deno.env.get('WAVEGUARD_ALLOWED_ORIGINS') || 'https://dwind-source.github.io').split(',').map(s => s.trim())));
