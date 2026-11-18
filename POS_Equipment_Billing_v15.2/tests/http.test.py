"""Start the shipped localhost server and request every runtime asset (same process namespace)."""
import subprocess,sys,urllib.request,time,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=subprocess.Popen([sys.executable,'-u',str(root/'serve.py')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
results=[]
try:
    for i in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8765/index.html',timeout=1) as r:r.read()
            break
        except Exception:time.sleep(.1)
    for n in ['index.html','app.js','case-data.js','case-ui.js','case-workspace.css','import-io.js','import-worker.js',
              'quote-pdf.js','vendor/quote/pdf-lib.min.js','vendor/quote/noto-tc.cff.js','vendor/xlsx.full.min.js','vendor/pdf.min.js','vendor/pdf.worker.min.js','vendor/pdf-resources.js','manifest.webmanifest']:
        try:
            with urllib.request.urlopen('http://127.0.0.1:8765/'+n,timeout=2) as r:results.append({'file':n,'status':'PASS' if r.status==200 else 'FAIL','httpStatus':r.status,'bytes':len(r.read())})
        except Exception as e:results.append({'file':n,'status':'FAIL','reason':str(e)})
finally:
    p.terminate();out,err=p.communicate(timeout=5)
result={'results':results,'startupLog':out,'serverLog':err}
if '--save' in sys.argv:(root/'docs/http-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
if any(r['status']!='PASS' for r in results):raise SystemExit(1)
