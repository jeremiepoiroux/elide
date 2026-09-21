#!/usr/bin/env python3
"""spaCy NER server for Elide — port 8772
Supports FR, EN, DE via lang parameter in request body.

Install models:
  pip3 install spacy
  python3 -m spacy download fr_core_news_lg   # français
  python3 -m spacy download en_core_web_lg    # anglais
  python3 -m spacy download de_core_news_lg   # allemand

Run: python3 spacy_ner.py
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, sys

try:
    import spacy
except ImportError:
    print("Missing dependency: pip3 install spacy")
    sys.exit(1)

SPACY_MODELS = {
    "fr": "fr_core_news_lg",
    "en": "en_core_web_lg",
    "de": "de_core_news_lg",
}
_nlp_cache = {}

def get_nlp(lang):
    if lang not in _nlp_cache:
        model = SPACY_MODELS.get(lang, SPACY_MODELS["fr"])
        try:
            print(f"Loading {model}…")
            _nlp_cache[lang] = spacy.load(model)
            print(f"{model} ready")
        except OSError:
            print(f"Model not found — run: python3 -m spacy download {model}")
            return None
    return _nlp_cache[lang]

# Pre-load French at startup
get_nlp("fr")
print("spaCy NER server → http://localhost:8772  (FR/EN/DE)")

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
        nlp = get_nlp(lang)
        if nlp is None:
            payload = json.dumps({"entities": [], "error": f"Model for '{lang}' not loaded"}).encode()
            self.send_response(503)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(payload))
            self.end_headers()
            self.wfile.write(payload)
            return
        doc = nlp(text)
        entities = [
            {"word": ent.text, "type": LABEL_MAP[ent.label_], "score": 1.0}
            for ent in doc.ents
            if ent.label_ in LABEL_MAP
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


HTTPServer(("localhost", 8772), Handler).serve_forever()
