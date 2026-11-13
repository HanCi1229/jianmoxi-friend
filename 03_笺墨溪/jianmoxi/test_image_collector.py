import io,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from collect_images import collect

class CollectorTests(unittest.TestCase):
 def test_ingestion_pending_dedup_and_outage_preserves_assets(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);db=root/'app.db';buf=io.BytesIO();Image.new('RGB',(600,450),'green').save(buf,'JPEG')
   rows=[dict(id='20',author='Author',url='https://unsplash.com/photos/test',download_url='https://picsum.photos/id/20/600/450',width=600,height=450)]
   def source(url):return json.dumps(rows).encode() if '/v2/list' in url else buf.getvalue()
   with patch('collect_images.get',side_effect=source),patch('collect_images.time.sleep'):
    self.assertEqual(collect(root,db,limit=12)['added'],1)
    self.assertEqual(collect(root,db,limit=12)['added'],0)
   before=(root/'manifest.json').read_bytes()
   with patch('collect_images.get',side_effect=RuntimeError('offline')):
    with self.assertRaises(SystemExit):collect(root,db)
   self.assertEqual((root/'manifest.json').read_bytes(),before)
   with sqlite3.connect(db) as con:
    self.assertEqual(con.execute('SELECT status,count(*) FROM image_assets').fetchone(),('pending',1))
    self.assertEqual(con.execute('SELECT count(*) FROM image_import_runs').fetchone()[0],3)

if __name__=='__main__':unittest.main()
