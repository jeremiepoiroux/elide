#!/usr/bin/env python3
"""HuggingFace NER server for Elide — port 8773
Multilingual: routes to the best model per language.

  FR/DE → Davlan/bert-base-multilingual-cased-ner-hrl  (~700 MB, multilingual)
  EN    → dslim/bert-base-NER                          (~420 MB)

All models use BERT/WordPiece tokenizer — no sentencepiece required.

Install: pip3 install transformers torch
Run:     python3 camembert_ner.py
         (each model downloads on first use)
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, sys

try:
    from transformers import pipeline
except ImportError:
    print("Missing dependency: pip3 install transformers torch")
    sys.exit(1)

HF_MODELS = {
    "fr": "Davlan/bert-base-multilingual-cased-ner-hrl",
    "de": "Davlan/bert-base-multilingual-cased-ner-hrl",
    "en": "dslim/bert-base-NER",
}
_pipelines = {}

def get_pipe(lang):
    if lang not in _pipelines:
        model = HF_MODELS.get(lang, HF_MODELS["fr"])
        try:
            print(f"Loading {model}…")
            _pipelines[lang] = pipeline(
                "ner",
                model=model,
                aggregation_strategy="simple",
                device=-1,
            )
            print(f"{model} ready")
        except Exception as e:
            print(f"[error] Failed to load {model}: {e}")
            return None
    return _pipelines[lang]

# Pre-load French at startup
get_pipe("fr")
print("HF NER server → http://localhost:8773  (FR/DE/EN)")

LABEL_MAP = {"PER": "PER", "LOC": "LOC", "ORG": "ORG", "MISC": "MISC"}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/ner":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        text = body.get("text", "")
        lang = body.get("lang", "fr")
        try:
            pipe = get_pipe(lang)
            if pipe is None:
                raise RuntimeError(f"Model for lang='{lang}' failed to load — check server terminal")
            results = pipe(text)
            print(f"[debug] lang={lang} text_len={len(text)} raw={results[:5]}")
        except Exception as e:
            payload = json.dumps({"entities": [], "error": str(e)}).encode()
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(payload))
            self.end_headers()
            self.wfile.write(payload)
            return
        entities = [
            {
                "word": r["word"],
                "type": LABEL_MAP.get(r["entity_group"], "MISC"),
                "score": float(r["score"]),
            }
            for r in results
            if r.get("entity_group") in LABEL_MAP and r["score"] >= 0.6
        ]
        payload = json.dumps({"entities": entities}).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


HTTPServer(("localhost", 8773), Handler).serve_forever()
