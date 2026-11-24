from io import BytesIO
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_editor_study_pack import Assets, READER, packet_bytes


class EditorStudyPack(unittest.TestCase):
    def test_kit_contains_only_offline_assets_and_participant_case_fields(self):
        with ZipFile(BytesIO(packet_bytes())) as archive, TemporaryDirectory() as directory:
            names = set(archive.namelist())
            expected = {'시작 안내.txt', 'editor-study.html', 'factcheck.html'}
            for page in ('editor-study.html', 'factcheck.html'):
                scanner = Assets()
                scanner.feed(archive.read(page).decode())
                expected.update(scanner.names)
            self.assertEqual(names, expected)
            page = archive.read('editor-study.html').decode()
            self.assertIn('data-participant-kit', page)
            self.assertIn('id="invite-code" required', page)
            self.assertIn('id="resume-file"', page)
            self.assertIn('editor-study-resume.js', expected)
            self.assertIn('이어하기 파일', archive.read('시작 안내.txt').decode())
            for marker in ['id="dashboard"', 'id="demo-view"', 'id="demo-example"', 'id="timing-coverage"', 'id="case-quality"', 'id="issue-codes"', 'id="import-files"']:
                self.assertNotIn(marker, page)
            self.assertNotIn('editor-study.html', archive.read('factcheck.html').decode())
            cases = archive.read('editor-study-cases.js')
            core = archive.read('editor-study-core.js')
            for marker in (b'expectedVerdict', b'expectedSourceIds', b'item.key', b'item.anchor'):
                self.assertNotIn(marker, cases)
                self.assertNotIn(marker, core)
            self.assertNotIn(b'function demoRecords', core)
            self.assertNotIn(b'function verdictStats', core)
            archive.extractall(directory)
            # Exercise the exact compiled study assets. Verify all eight public
            # case variants and the assignment plan, without generating participant records.
            script = """
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const [kit, source] = process.argv.slice(1);
const box = vm.createContext({});
for (const file of ['editor-study-cases.js','editor-study-core.js','editor-study-resume.js']) vm.runInContext(fs.readFileSync(path.join(kit,file),'utf8'),box);
const actual = box.JournalStudyCases, original = require(path.join(source,'editor-study-cases.js'));
const copy = obj => JSON.parse(JSON.stringify(obj));
assert.deepEqual(copy(actual.ids), original.ids);
for (const id of original.ids) for (const variant of ['A','B']) {
  const {expectedVerdict, expectedSourceIds, ...publicFields} = original.get(id,variant);
  assert.deepEqual(copy(actual.get(id,variant)), publicFields);
}
const canonical = require(path.join(source,'editor-study-core.js'));
for (let slot=1; slot<=16; slot++) assert.deepEqual(copy(box.JournalEditorStudy.plan(slot)),canonical.plan(slot));
assert.equal(box.JournalEditorStudy.demoRecords,undefined);
assert.equal(box.JournalEditorStudy.partialTimeDemoRecords,undefined);
assert.equal(box.JournalEditorStudy.cueAgreementDemoRecords,undefined);
assert.equal(box.JournalEditorStudy.analyze,undefined);
const editor = box.JournalEditorStudy.createRecord('E0000000000000001',1,'editor',true);
assert.equal(box.JournalEditorResume.read(editor, editor).session.partialTime, true);
"""
            subprocess.run(['node', '-e', script, directory, str(READER)], check=True)
