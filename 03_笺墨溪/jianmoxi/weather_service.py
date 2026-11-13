"""Opt-in, city-level weather. No coordinates or location history are written to disk."""
import json
import math
import time
import threading
import urllib.parse
import urllib.request
from flask import jsonify, request

_cache = {}
_lock = threading.Lock()

def upstream(base, params, ttl=900):
    url = base + '?' + urllib.parse.urlencode(params)
    with _lock:
        cached = _cache.get(url)
        if cached and cached[0] > time.time():
            return cached[1]
    req = urllib.request.Request(url, headers={'User-Agent':'Jianmoxi/0.1.3 (https://49.234.43.25)'})
    with urllib.request.urlopen(req, timeout=8) as response:
        data = json.loads(response.read(1024*1024))
    with _lock:
        if len(_cache) >= 256:
            _cache.pop(next(iter(_cache)))
        _cache[url] = (time.time()+ttl, data)
    return data

def coordinates(data):
    lat, lon = data.get('lat'), data.get('lon')
    if type(lat) not in (int,float) or type(lon) not in (int,float):
        raise ValueError('位置无效，请重新选择城市')
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90<=lat<=90 or not -180<=lon<=180:
        raise ValueError('位置无效，请重新选择城市')
    return round(lat,2), round(lon,2)

def condition(code):
    if code==0:return '晴'
    if code in (1,2):return '多云'
    if code==3:return '阴'
    if code in (45,48):return '雾'
    if code in (51,53,55):return '细雨'
    if code in (56,57,66,67):return '冻雨'
    if code in (61,63,65,80,81,82):return '雨'
    if code in (71,73,75,77,85,86):return '雪'
    if code in (95,96,99):return '雷雨'
    return '天气更新中'

def register(app, rate):
    @app.post('/api/weather')
    def weather():
        if not rate('weather',30,60):return jsonify(error='操作较频繁，请稍后再试'),429
        data=request.get_json(silent=True)
        if not isinstance(data,dict):return jsonify(error='请求格式不正确'),400
        try:
            if data.get('action')=='cities':
                query=data.get('query','')
                if not isinstance(query,str) or not 2<=len(query.strip())<=80:
                    raise ValueError('请输入至少两个字的城市名')
                result=upstream('https://geocoding-api.open-meteo.com/v1/search',dict(name=query.strip(),count=6,language='zh',format='json'),86400)
                return jsonify(cities=[dict(name=r['name'],region=' · '.join(filter(None,[r.get('admin1'),r.get('country')])),lat=round(r['latitude'],2),lon=round(r['longitude'],2)) for r in result.get('results',[])])
            if data.get('action')!='current':raise ValueError('未知天气操作')
            lat,lon=coordinates(data)
            label=data.get('name','')
            if not isinstance(label,str) or len(label)>80:raise ValueError('城市名称无效')
            result=upstream('https://api.open-meteo.com/v1/forecast',dict(latitude=lat,longitude=lon,current='temperature_2m,weather_code',timezone='auto'))
            now=result['current'];temperature=now.get('temperature_2m');code=now.get('weather_code')
            if type(temperature) not in (int,float) or not math.isfinite(temperature) or type(code) is not int:
                return jsonify(error='天气数据暂不可用，请稍后重试'),503
            if not label:
                try:
                    places=upstream('https://photon.komoot.io/reverse',dict(lat=lat,lon=lon),86400).get('features',[])
                    p=places[0]['properties'] if places else {}
                    label=p.get('city') or p.get('county') or p.get('state') or ''
                except Exception:
                    pass
            return jsonify(name=label or '当前位置',temperature=round(temperature,1),condition=condition(code),observedAt=now['time'],updatedAt=int(time.time()),provider='Open-Meteo',lat=lat,lon=lon)
        except ValueError as e:return jsonify(error=str(e)),400
        except Exception:return jsonify(error='天气服务暂时不可用，请稍后重试'),503
