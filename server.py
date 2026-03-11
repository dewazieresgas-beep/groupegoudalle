from wsgiref.simple_server import make_server
import mimetypes
import os

DOSSIER = os.path.dirname(os.path.abspath(__file__))
PORT = 8080
HOST = "0.0.0.0"  # accessible depuis tout le réseau

def app(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    if path == "/":
        path = "/index.html"

    filepath = os.path.join(DOSSIER, path.lstrip("/").replace("/", os.sep))

    if os.path.isfile(filepath):
        mime, _ = mimetypes.guess_type(filepath)
        mime = mime or "application/octet-stream"
        with open(filepath, "rb") as f:
            data = f.read()
        start_response("200 OK", [("Content-Type", mime), ("Content-Length", str(len(data)))])
        return [data]
    else:
        start_response("404 Not Found", [("Content-Type", "text/plain")])
        return [b"Page non trouvee"]

if __name__ == "__main__":
    print(f"Serveur demarré sur http://{HOST}:{PORT}")
    print(f"Accès local      : http://localhost:{PORT}")
    print(f"Accès réseau     : http://<IP-du-PC>:{PORT}")
    print("Ctrl+C pour arrêter\n")
    httpd = make_server(HOST, PORT, app)
    httpd.serve_forever()
