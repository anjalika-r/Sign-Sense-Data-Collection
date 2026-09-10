# Sign Sense Data Collection

Run the local server from this folder:

```powershell
node server.js
```

Then open [http://localhost:8001](http://localhost:8001).

Each participant's saved landmarks and progress are kept only on the computer running the server, in `sessions/<participant name>/`. That folder is ignored by Git, so recordings are not uploaded when the project is pushed to GitHub.
