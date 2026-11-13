import copy
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

from werkzeug.security import generate_password_hash

import accounts
from cloud_app import EMPTY, create_app


class PersonalWorkspaceTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'app.db'
        self.legacy_password = 'old shared space password'
        self.owner_password = '溪'
        self.config = dict(TESTING=True, DB_PATH=str(self.path), PUBLIC_ORIGIN='http://localhost',
                           SECURE_COOKIE=False, OWNER_HASH=generate_password_hash(self.legacy_password))
        self.app = create_app(self.config)
        self.headers = {'Origin': 'http://localhost'}

    def post(self, client, path, value, scope=None):
        headers = dict(self.headers)
        if scope is not None:
            headers['X-Xingzou-Space'] = scope
        return client.post(path, json=value, headers=headers)

    def save(self, client, state, version, scope=None):
        headers = dict(self.headers)
        if scope is not None:
            headers['X-Xingzou-Space'] = scope
        return client.put('/api/state', json=dict(state=state, version=version), headers=headers)

    def state(self, client, scope):
        return client.get('/api/state', headers={'X-Xingzou-Space': scope}).json

    def test_existing_owner_and_friends_are_separate_even_after_switching(self):
        legacy = self.app.test_client()
        self.assertEqual(self.post(legacy, '/api/login', {'password': self.legacy_password}).status_code, 200)
        state = copy.deepcopy(EMPTY)
        state['articles'] = [dict(id='owner-draft', status='draft', date='2026-11-10',
                                  title='私有文章', content='仅属于原来的空间')]
        state['favs'] = ['wikisource-congcong']
        state['saved'] = [dict(id='owner-inspiration', short='仅个人收藏')]
        self.assertEqual(self.save(legacy, state, 0).status_code, 200)
        chat = self.post(legacy, '/api/conversations', {'title': '原来的私人对话'}).json['conversation']
        self.post(legacy, '/api/companion/memories', {'text': '仅原账号可见的记忆'})
        passage = dict(workId='wikisource-congcong', text='燕子去了，有再来的时候')
        excerpt = self.post(legacy, '/api/excerpts', passage).json['item']

        activation = 'a' * 43
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("INSERT INTO accounts VALUES ('owner','hanci','')")
            connection.execute("INSERT INTO account_invites VALUES (?,'owner',?)",
                               (accounts.digest(activation), int(time.time()) + 600))
        self.assertEqual(legacy.get('/api/state').status_code, 401)
        self.assertEqual(self.post(legacy, '/api/login', {'password': self.legacy_password}).status_code, 401)
        self.assertEqual(self.post(legacy, '/api/login', {'username': 'hanci', 'password': self.legacy_password}).status_code, 401)
        self.assertEqual(self.post(legacy, '/api/register', dict(username='hanci', password=self.owner_password,
                                                                code=activation)).status_code, 400)

        with closing(sqlite3.connect(self.path)) as connection:
            with self.assertRaises(ValueError):
                accounts.configure_owner(connection, 'chosen-owner', self.legacy_password, self.config['OWNER_HASH'])
            accounts.configure_owner(connection, 'chosen-owner', self.owner_password, self.config['OWNER_HASH'])
            self.assertEqual(connection.execute("SELECT count(*) FROM account_invites WHERE purpose='owner'").fetchone()[0], 0)
            with self.assertRaises(ValueError):
                accounts.configure_owner(connection, 'other-owner', 'different-password')
        owner = self.app.test_client()
        self.assertEqual(self.post(owner, '/api/login', dict(username='chosen-owner', password=self.owner_password)).status_code, 200)
        self.assertEqual(owner.get('/api/session').json['account'],
                         dict(id='owner', username='chosen-owner', owner=True))
        self.assertEqual(self.post(self.app.test_client(), '/api/register',
                                   dict(username='other-owner', password=self.owner_password,
                                        code=activation)).status_code, 400)
        self.assertEqual(self.state(owner, 'owner'), dict(state=state, version=1))
        self.assertEqual(owner.get('/api/conversations').json['conversations'][0]['id'], chat['id'])
        self.assertEqual(self.post(owner, '/api/account/invites', {}).status_code, 401)
        invitation = self.post(owner, '/api/account/invites', {}, 'owner').json['code']
        friend = self.app.test_client()
        registration = dict(username='friend-one', password='x' * 205, code=invitation)
        self.assertEqual(self.post(friend, '/api/register', registration).status_code, 200)
        scope = friend.get('/api/session').json['account']['id']
        self.assertEqual(self.state(friend, scope), dict(state=EMPTY, version=0))
        self.assertEqual(friend.get('/api/state').status_code, 401)
        self.assertEqual(friend.get('/api/conversations').json['conversations'], [])
        self.assertEqual(friend.get('/api/conversations/' + chat['id']).status_code, 404)
        self.assertEqual(friend.get('/api/excerpts').json['items'], [])
        self.assertEqual(friend.get('/api/companion/settings').json['memories'], [])
        self.assertEqual(friend.get('/api/library?favorites=1').json['total'], 0)
        self.assertGreater(friend.get('/api/library').json['libraryTotal'], 0)
        self.assertTrue(friend.get('/api/inspiration/library').json['items'])
        self.assertEqual(self.post(friend, '/api/account/invites', {}, scope).status_code, 403)
        self.assertEqual(self.post(self.app.test_client(), '/api/register',
                                   dict(registration, username='friend-two')).status_code, 400)

        self.assertEqual(friend.get('/api/state', headers={'X-Xingzou-Space': 'owner'}).status_code, 401)
        self.assertEqual(self.save(friend, state, 0, 'owner').status_code, 401)
        self.assertEqual(self.save(friend, state, 0).status_code, 401)
        new_state = copy.deepcopy(EMPTY)
        new_state['articles'] = [dict(id='owner-draft', status='draft', date='2026-11-10',
                                      title='朋友的文章', content='只保存到朋友的空间')]
        self.assertEqual(self.save(friend, new_state, 0, scope).status_code, 200)
        self.assertEqual(self.state(owner, 'owner')['state'], state)
        self.assertEqual(owner.get('/api/excerpts').json['items'][0]['id'], excerpt['id'])
        self.assertEqual(self.post(friend, '/api/logout', {}, scope).status_code, 200)
        self.assertEqual(friend.get('/api/state').status_code, 401)
        restarted = create_app(self.config).test_client()
        self.assertEqual(self.post(restarted, '/api/login', dict(username='FRIEND-ONE',
                                                               password=registration['password'])).status_code, 200)
        self.assertEqual(self.state(restarted, scope)['state'], new_state)
