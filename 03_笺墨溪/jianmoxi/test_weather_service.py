import unittest
from unittest.mock import patch
from flask import Flask
import weather_service

class WeatherTests(unittest.TestCase):
 def setUp(self):
  self.app=Flask(__name__);weather_service.register(self.app,lambda *args:True);self.client=self.app.test_client()
 def post(self,data):return self.client.post('/api/weather',json=data)
 def test_invalid_positions_do_not_reach_provider(self):
  with patch('weather_service.upstream') as upstream:
   for lat,lon in [(91,20),(30,181),('30',120),(True,120),(None,10)]:
    self.assertEqual(self.post(dict(action='current',lat=lat,lon=lon)).status_code,400)
   upstream.assert_not_called()
 def test_zero_temperature_and_coarse_location(self):
  with patch('weather_service.upstream',return_value={'current':{'temperature_2m':0,'weather_code':0,'time':'2026-11-04T12:00'}}) as upstream:
   r=self.post(dict(action='current',lat=30.123456,lon=120.654321,name='杭州'))
   self.assertEqual(r.status_code,200);self.assertEqual(r.json['temperature'],0);self.assertEqual(r.json['condition'],'晴')
   self.assertEqual(upstream.call_args.args[1]['latitude'],30.12);self.assertEqual(r.json['lon'],120.65)
 def test_reverse_failure_keeps_real_weather(self):
  with patch('weather_service.upstream',side_effect=[{'current':{'temperature_2m':18,'weather_code':51,'time':'2026-11-04T12:00'}},OSError()]):
   r=self.post(dict(action='current',lat=30,lon=120));self.assertEqual(r.status_code,200);self.assertEqual(r.json['name'],'当前位置')
 def test_provider_failure_never_fabricates_weather(self):
  with patch('weather_service.upstream',side_effect=OSError()):self.assertEqual(self.post(dict(action='current',lat=30,lon=120,name='杭州')).status_code,503)
  with patch('weather_service.upstream',return_value={'current':{'temperature_2m':None,'weather_code':0}}):self.assertEqual(self.post(dict(action='current',lat=30,lon=120,name='杭州')).status_code,503)
 def test_city_search_empty_result(self):
  with patch('weather_service.upstream',return_value={}):self.assertEqual(self.post(dict(action='cities',query='不存在')).json,{'cities':[]})
 def test_rate_limit(self):
  app=Flask('limit');weather_service.register(app,lambda *args:False)
  self.assertEqual(app.test_client().post('/api/weather',json={'action':'cities','query':'杭州'}).status_code,429)
if __name__=='__main__':unittest.main()
