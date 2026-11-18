"""Check original anchors, file roles and local runtime assets in the source or release tree."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import json

root = Path(__file__).resolve().parents[1]
site = root / 'site' if (root / 'site/index.html').is_file() else root
visible = {'caseWorkspace', 'hm', 'invoice', 'vendorMsg', 'ar'}
types = {
    'casePos': '.xlsx,.xls', 'caseQuote': '.xlsx,.xls', 'caseSap': '.xlsx,.xls',
    'caseRequests': '.xlsx,.xls', 'caseWork': '.json',
    'hmPosFile': '.xlsx,.xls', 'hmSalesFiles': '.pdf', 'invoiceFile': '.xlsx,.xls',
    'posFile': '.xlsx,.xls', 'vendorPosFile': '.xlsx,.xls',
    'hmImportFile': '.xlsx,.xls', 'hmArFile': '.pdf,.xlsx,.xls'
}

class Site(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.files, self.sections, self.assets = set(), {}, set(), set()
        self.details = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.details += tag == 'details'
        if item := a.get('id'):
            assert item not in self.ids, f'duplicate HTML ID {item}'
            self.ids.add(item)
            if item in visible:
                assert not self.details, f'{item} hidden in a disclosure'
                self.sections.add(item)
            if tag == 'input' and a.get('type') == 'file':
                self.files[item] = a.get('accept')
        if tag in ('script', 'link'):
            asset = a.get('src') or a.get('href', '')
            if asset and not asset.startswith(('http:', 'https:', 'data:', '#')):
                parsed = urlsplit(asset)
                assert not parsed.path.startswith('/'), f'absolute browse path {asset}'
                self.assets.add(parsed.path)

    def handle_endtag(self, tag):
        self.details -= tag == 'details'

page = Site()
page.feed((site / 'index.html').read_text())
assert page.sections == visible
assert page.files == types
html = (site / 'index.html').read_text()
assert '202601-03報價單匯出 POS TEAM用' not in html
assert html.count('SAP資料庫') >= 2 and '#caseSapDatabase' in html
assert 'caseOrderPreview' in page.ids and '廠商下單文字 Excel' not in html
assert 'vendor/quote/noto-tc.cff.js' not in page.assets
assert {'hmBtn', 'convertBtn', 'generateVendorMsgBtn', 'arCompareBtn', 'arQueryBtn', 'arQueryExportBtn'} <= page.ids
assert 'vendor/pdf.min.js' not in page.assets
assert 'vendor/xlsx.full.min.js' not in page.assets and 'embeddedSheetJS' in page.ids
assert 'deploymentStatus' in page.ids and 'assets.js' in page.assets
assert (site / '.nojekyll').is_file()
assert len([p for p in site.rglob('*') if p.is_file()]) <= 100
assert not (site / 'vendor/cmaps').exists()
assert not (site / 'vendor/standard_fonts').exists()
for asset in page.assets | {'import-worker.js', 'vendor/pdf.min.js', 'vendor/pdf-resources.js', 'vendor/pdf.worker.min.js', 'vendor/xlsx.full.min.js', 'vendor/quote/pdf-lib.min.js', 'vendor/quote/noto-tc.cff.js'}:
    assert (site / asset).is_file(), f'missing browser asset {asset}'
manifest = json.loads((site / 'manifest.webmanifest').read_text())
assert manifest['start_url'] == './index.html'
for item in manifest['icons']:
    assert (site / item['src']).is_file()
print(f'PASS: {len(page.sections)} exposed work areas, {len(page.files)} import inputs, unique IDs and local assets')
