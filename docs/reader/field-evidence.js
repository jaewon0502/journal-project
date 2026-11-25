(function (root) {
  'use strict';
  const el = id => document.getElementById(id);
  const citation = root.JournalFieldCitation;
  function create(apply) {
    const panel = el('field-evidence');
    const file = el('evidence-work');
    const paste = el('evidence-paste');
    const select = el('evidence-choices');
    const preview = el('evidence-preview');
    const status = el('evidence-status');
    let trial = null, request = 0, choices = [];
    function clearChoices() {
      request++;
      choices = [];
      select.replaceChildren();
      el('evidence-selection').hidden = true;
      preview.textContent = '';
      status.textContent = '';
    }
    function reset() {
      clearChoices();
      file.value = '';
      paste.value = '';
      panel.open = false;
    }
    function showLocation() {
      const choice = select.value === '' ? null : choices[Number(select.value)];
      preview.textContent = choice ? choice.location.documentUrl + '\n' + choice.location.locator : '';
      el('evidence-apply').disabled = !choice || select.value === '';
    }
    function showChoices(entries) {
      choices = entries;
      select.replaceChildren(new Option('원자료를 선택하세요',''));
      for (const [i, item] of entries.entries()) {
        select.add(new Option(item.label + ' · ' + item.location.locator, String(i)));
      }
      select.value = entries.length === 1 ? '0' : '';
      el('evidence-selection').hidden = false;
      showLocation();
    }
    select.onchange = showLocation;
    paste.oninput = () => {
      clearChoices();
      file.value = '';
      if (!trial || !paste.value.trim()) return;
      try { showChoices([{label:'복사한 위치',location:citation.decode(paste.value)}]); }
      catch (err) { status.textContent = err.message; }
    };
    file.onchange = async () => {
      const picked = file.files[0];
      if (!trial || !picked) return;
      clearChoices();
      paste.value = '';
      file.value = '';
      const token = request;
      try {
        const text = await picked.text();
        if (token !== request) return;
        let work;
        try { work = JSON.parse(text.replace(/^\uFEFF/u,'')); }
        catch { throw Error('팩트체크에서 저장한 JSON 작업 파일을 선택하세요.'); }
        const entries = citation.registered(work);
        showChoices(entries);
        status.textContent = '등록된 원자료 ' + entries.length + '개에서 이 과제에 사용한 위치를 확인하세요.';
      } catch (err) {
        if (token === request) status.textContent = err.message;
      }
    };
    el('evidence-apply').onclick = () => {
      const pick = select.value === '' ? null : choices[Number(select.value)];
      if (trial && pick && apply(pick.location)) {
        reset();
        el('locator').focus();
      }
    };
    return {update(id) {
      if (id !== trial) reset();
      trial = id;
      panel.hidden = !id;
    }};
  }
  root.JournalFieldEvidence = Object.freeze({create});
})(globalThis);
