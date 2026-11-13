import unittest
from deploy.clean_demo_content import clean_state

class CleanupTests(unittest.TestCase):
    def test_only_exact_examples_removed(self):
        original={'id':'a1','title':'Example','content':'Original sample'}
        changed={**original,'content':'My own edit'}
        same_title={'id':'user-created','title':'Example','content':'Original sample'}
        state={'articles':[changed,same_title],'trash':[original],'favs':['r1','wikisource-congcong'],'currentId':'user-created','activity':{'2026-11-02':{'chars':5,'edits':1}},'saved':[{'id':'my-favourite'}]}
        cleaned,removed=clean_state(state,[original])
        self.assertEqual(cleaned['articles'],[changed,same_title])
        self.assertEqual(removed,['a1'])
        self.assertEqual(cleaned['trash'],[])
        self.assertEqual(cleaned['favs'],['wikisource-congcong'])
        self.assertEqual(cleaned['activity'],state['activity'])
        self.assertEqual(cleaned['saved'],state['saved'])
        self.assertEqual(len(state['trash']),1)

    def test_removed_current_id_clears_and_repeat_is_safe(self):
        example={'id':'a1','title':'Example','content':'Original sample'}
        state={'articles':[example],'trash':[],'favs':['r2'],'currentId':'a1'}
        cleaned,_=clean_state(state,[example])
        self.assertIsNone(cleaned['currentId'])
        self.assertEqual(cleaned['articles'],[])
        self.assertEqual(clean_state(cleaned,[example]),(cleaned,[]))

if __name__=='__main__':unittest.main()
