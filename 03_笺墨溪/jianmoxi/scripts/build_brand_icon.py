"""Render the approved paper-white, vermilion-frame wordmark at export resolution."""
from pathlib import Path
import base64
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'design-review/icon-20261104/final';OUT.mkdir(parents=True,exist_ok=True)
SERIF='/System/Library/Fonts/Supplemental/Songti.ttc'
SCRIPT='/System/Library/AssetsV2/com_apple_MobileAsset_Font8/13b8ce423f920875b28b551f9406bf1014e0a656.asset/AssetData/Xingkai.ttc'
def render(size,mono=False):
 k=size/768;im=Image.new('RGBA',(size,size));d=ImageDraw.Draw(im)
 def rect(b,r,**kw):d.rounded_rectangle(tuple(round(v*k) for v in b),radius=round(r*k),**kw)
 if not mono:
  rect((0,0,767,767),170,fill='#eee9de')
  rect((47,47,720,720),130,outline='#a34b3e',width=max(1,round(11*k)))
 font=ImageFont.truetype(SERIF,round(502*k),index=1);b=d.textbbox((0,0),'笺',font=font)
 x=(size-(b[2]-b[0]))/2-b[0]-6*k;y=(size-(b[3]-b[1]))/2-b[1]+9*k
 d.text((x,y),'笺',font=font,fill='white' if mono else '#283b35')
 if not mono:
  rect((620,141,688,287),3,fill='#a34b3e')
  small=ImageFont.truetype(SCRIPT,round(43*k),index=1)
  for i,ch in enumerate('箋墨溪'):
   b=d.textbbox((0,0),ch,font=small)
   d.text((654*k-(b[2]-b[0])/2-b[0],(150+i*44)*k-b[1]),ch,font=small,fill='#f5edde')
 return im
master=render(2048);master.save(OUT/'jianmoxi-icon-2048.png')
for n in [512,192,96,48]:master.resize((n,n),Image.Resampling.LANCZOS).save(OUT/f'jianmoxi-icon-{n}.png')
assets=ROOT/'dist/assets';master.resize((512,512),Image.Resampling.LANCZOS).save(assets/'jianmoxi-icon.png')
encoded=base64.b64encode((assets/'jianmoxi-icon.png').read_bytes()).decode()
(assets/'jianmoxi-icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>笺墨溪</title><image width="512" height="512" href="data:image/png;base64,'+encoded+'"/></svg>')
res=ROOT/'android/res/drawable-nodpi';res.mkdir(exist_ok=True)
# Android adaptive foreground is larger than the visible launcher mask.
for name,source in [('brand_foreground',master),('brand_mono',render(2048,True))]:
 canvas=Image.new('RGBA',(864,864));scaled=source.resize((512,512),Image.Resampling.LANCZOS);canvas.alpha_composite(scaled,(176,176));canvas.save(res/(name+'.png'))
print('Exported 2048px master, four sizes, web icon and Android adaptive layers.')
