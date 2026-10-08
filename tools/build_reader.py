#!/usr/bin/env python3
"""Render the public evidence reader using only the checked public JSON data.

No network, model execution, article full text, or external runtime is needed.
Run with --check to verify that the committed HTML matches its source data.
"""
from __future__ import annotations

import argparse
from html import escape
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / 'docs/reader-data.json'
OUTPUT_PATH = ROOT / 'docs/reader/index.html'
REPO_URL = 'https://github.com/jaewon0502/journal-project'
STATUSES = {'applied', 'held', 'corrected', 'unchanged'}
REVIEW_TITLES = {
    'ps-body': '혈액 미세플라스틱 · PS 명칭',
    'generation-estimate': '태양광 · 발전량의 측정과 추정',
    'size-attribution': '태양광 · 크기 비교와 발언 귀속',
    'plot-area': '태양광 · 두 면적의 비교',
    'maturity-delay': '태양광 · 성숙 지연 기간',
    'material-list': '미세플라스틱 · 재질 목록',
    'precision-80-77': '미세플라스틱 · 비율의 표현',
    'evisa-timing': 'eVisa · 기사와 권고의 시점',
    'sealevel-control': '해수면 · 대조 자료의 수치와 연도',
    'sealevel-year': '해수면 · 합성 변형 자료의 연도',
}


def e(value):
    return escape(str(value), quote=True)


def external_url(value):
    parsed = urlparse(value)
    if parsed.scheme not in ('https', 'http') or not parsed.netloc:
        raise ValueError(f'Expected a public HTTP(S) URL: {value!r}')
    return value


def record_url(path, ref):
    if path.startswith(('https://', 'http://')):
        return external_url(path)
    if path.startswith('/') or '..' in Path(path).parts:
        raise ValueError('Record path must be repository relative')
    return f'{REPO_URL}/blob/{ref}/{path}'


def read_data():
    data = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    for key in ('schema_version', 'title', 'version', 'research_ref', 'scope', 'limits', 'human_reference', 'cases', 'versions'):
        if key not in data:
            raise ValueError(f'Missing data field: {key}')
    if not re.fullmatch(r'[0-9a-f]{40}', data['research_ref']):
        raise ValueError('research_ref must be an immutable 40-character Git commit')
    ids = [case['id'] for case in data['cases']]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Cases must have unique IDs')
    for case in data['cases']:
        if case['status'] not in STATUSES or not re.fullmatch(r'[A-Za-z0-9_-]+', case['id']):
            raise ValueError('Unsupported status or case ID')
        for key in ('title', 'status_label', 'summary', 'original', 'proposal', 'reason', 'remaining', 'evidence', 'record_path'):
            if key not in case:
                raise ValueError(f'Missing case field: {key}')
        for pair in ('original', 'proposal'):
            if case[pair]['kind'] not in ('exact', 'summary', 'unavailable'):
                raise ValueError('Text kind must explicitly distinguish exact, summary, and unavailable')
        for evidence in case['evidence']:
            external_url(evidence['url'])
        record_url(case['record_path'], data['research_ref'])
    return data


def passage(part):
    kind = part['kind']
    if kind == 'unavailable' or not part.get('text'):
        return '<span class="text-kind">공개 범위' + '</span><p class="muted">이 구간의 실제 문구는 공개 자료에 없습니다. 원자료에서 앞뒤 문맥을 확인해야 합니다.</p>'
    label = '공개된 실제 문구' if kind == 'exact' else '보고서 작성자의 요약 · 실제 문구 아님'
    tag = 'blockquote' if kind == 'exact' else 'p'
    return f'<span class="text-kind">{label}</span><{tag}>{e(part["text"])}</{tag}>'


def evidence_markup(case):
    parts = []
    for index, source in enumerate(case['evidence'], 1):
        kind = source.get('kind', 'summary')
        kind_label = '공개 원자료 인용' if kind == 'exact_quote' else '보고서 작성자의 근거 요약 · 원자료 직접 인용 아님'
        link_label = '해당 PDF 쪽 열기' if re.search(r'#page=\d+', source['url']) else '원자료 열기'
        text = source.get('text') or '이 자료의 인용문은 공개하지 않았습니다. 연결된 원자료와 표시한 위치를 직접 확인하세요.'
        parts.append(f'''<article class="source"><p class="eyebrow">근거 {index}</p><h4>{e(source['title'])}</h4><p class="source-meta">{e(source.get('source_date') or '발행일 미제공')} · {e(source.get('location') or '세부 위치 미제공')}</p><p class="text-kind">{kind_label}</p><p>{e(text)}</p><a class="source-link" href="{e(external_url(source['url']))}" target="_blank" rel="noopener noreferrer">{link_label} <span aria-hidden="true">↗</span></a><p class="source-scope">{e(source.get('scope_note') or '자료의 확인 범위는 해당 기록을 참고하세요.')}</p></article>''')
    if not parts:
        return '<p class="empty">이 항목에 공개된 원자료 링크가 없습니다. 근거를 확인하지 못한 상태로 남겨 둡니다.</p>'
    return ''.join(parts)


CSS = r'''
:root{--paper:#f6f5f1;--ink:#203a35;--muted:#56675f;--green:#275d50;--line:#d7ded6;--soft:#e9eee7;--white:#fffefa;color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}html{font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:var(--paper);color:var(--ink);scroll-behavior:smooth}body{margin:0}a{color:var(--green);text-underline-offset:4px;overflow-wrap:anywhere}button,input,select,textarea{font:inherit;max-width:100%;color:var(--ink)}button{cursor:pointer;border:1px solid var(--line);background:var(--white);border-radius:6px;padding:10px 15px}button:hover{background:var(--soft)}button.primary{background:var(--green);color:white;border-color:var(--green)}*:focus-visible{outline:3px solid #ad6329;outline-offset:4px}h1,h2,h3,h4,p{margin:0 0 12px}h1{font-size:clamp(1.85rem,3.3vw,2.75rem);line-height:1.27;letter-spacing:-.045em}h2{font-size:1.4rem;line-height:1.4;letter-spacing:-.025em}h3{font-size:1.3rem;line-height:1.45;letter-spacing:-.025em}h4{font-size:1.02rem}p:last-child{margin-bottom:0}.wrap{width:min(1220px,100%);margin:auto;padding:0 30px}.topbar{border-bottom:1px solid var(--line)}.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:72px}.brand{font-size:1.06rem;letter-spacing:.04em;font-weight:760;text-decoration:none;color:var(--ink)}.topbar a:last-child{font-size:.82rem}.skip{position:fixed;top:-90px;left:12px;z-index:10;background:white;padding:12px}.skip:focus{top:12px}.modebar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:24px 0}.mode-toggle{display:flex;border:1px solid var(--line);padding:4px;background:#eaece6;border-radius:9px}.mode-toggle button{border:0;padding:8px 18px;background:transparent;font-size:.92rem}.mode-toggle button[aria-pressed=true]{background:var(--white);box-shadow:0 1px 3px #203a3512;font-weight:700}.mode-hint{font-size:.82rem;color:var(--muted)}.intro{max-width:910px;margin:0 0 24px}.eyebrow{color:var(--green);font-size:.73rem;font-weight:750;letter-spacing:.09em;margin-bottom:8px}.lead{font-size:1.03rem;color:var(--muted);margin-top:15px;max-width:890px}.metadata{font-size:.8rem;color:var(--muted);margin-top:12px}.countline{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}.badge{display:inline-flex;align-items:center;border-radius:4px;background:var(--soft);color:var(--green);font-size:.74rem;font-weight:650;padding:3px 8px}.badge.held{background:#f0eadd;color:#715a27}.badge.corrected{background:#e7ecee;color:#355762}.badge.unchanged{background:#ebece8;color:#506057}.fine{font-size:.78rem!important;color:var(--muted)}.muted{color:var(--muted)}.section-head{display:flex;gap:18px;justify-content:space-between;align-items:baseline;margin-bottom:15px}.section-head p{font-size:.82rem;color:var(--muted)}.workspace{display:grid;grid-template-columns:minmax(245px,310px) minmax(0,1fr);gap:24px;align-items:start}.browser{border:1px solid var(--line);background:var(--white);border-radius:9px;overflow:hidden}.browser-tools{padding:16px;border-bottom:1px solid var(--line)}.browser-tools label{display:block;font-size:.79rem;font-weight:650;margin-bottom:5px}input[type=search]{width:100%;border:1px solid #a6b6aa;border-radius:5px;padding:9px 11px;font-size:.9rem;background:white}.filters{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.filters button{font-size:.75rem;padding:4px 8px}.filters button[aria-pressed=true]{background:var(--green);color:white;border-color:var(--green)}.claim-list{list-style:none;padding:0;margin:0;max-height:740px;overflow:auto}.claim-list li+li{border-top:1px solid #e7ece5}.claim-select{display:block;text-align:left;border:0;border-radius:0;width:100%;padding:16px;background:transparent}.claim-select[aria-current=true]{background:#e8eee7;box-shadow:inset 3px 0 var(--green)}.claim-select .title{display:block;font-size:.94rem;font-weight:650;line-height:1.5;margin-bottom:8px}.list-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:.72rem;color:var(--muted)}.count-result{font-size:.77rem;padding:11px 16px;border-top:1px solid var(--line);color:var(--muted)}.card{background:var(--white);border:1px solid var(--line);border-radius:9px;padding:27px;min-width:0}.card-heading{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:14px}.card h3{font-size:1.42rem}.card-summary{font-size:.96rem;margin-top:14px}.comparison{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:7px;overflow:hidden;margin:23px 0}.comparison>div{padding:19px;min-width:0}.comparison>div+div{border-left:1px solid var(--line);background:#f1f4ed}.comparison h4{font-size:.8rem;color:var(--muted);margin-bottom:10px}.comparison p,.comparison blockquote{font-size:.95rem;overflow-wrap:anywhere}.comparison blockquote{margin:0}.text-kind{display:block;font-size:.73rem!important;color:var(--muted);margin-bottom:9px}.reason{padding-bottom:21px;border-bottom:1px solid var(--line);margin-bottom:23px}.reason h4{font-size:.83rem;color:var(--muted)}.reason p{font-size:.91rem}.source{border-left:3px solid #6b8874;padding-left:18px;margin:22px 0}.source h4{font-size:1rem}.source p{font-size:.91rem;overflow-wrap:anywhere}.source .eyebrow{font-size:.7rem}.source .source-meta{font-size:.78rem;color:var(--muted)}.source .source-scope{font-size:.78rem;color:var(--muted);margin-top:12px}.source-link{display:inline-flex;gap:18px;background:var(--soft);padding:9px 13px;border-radius:5px;margin-top:4px;text-decoration:none;font-size:.84rem;font-weight:650}.source-link:hover{text-decoration:underline}.remaining{font-size:.88rem;padding:16px 18px;background:#f4f1e8;border:1px solid #e4dfd0;border-radius:7px;margin:22px 0}.remaining h4{font-size:.88rem}.remaining ul{padding-left:20px;margin-bottom:0}.remaining li+li{margin-top:7px}details{margin-top:18px}summary{cursor:pointer;font-weight:650;padding:9px 0}details[open]>summary{margin-bottom:8px}.technical{font-size:.79rem;color:var(--muted);overflow-wrap:anywhere}.technical code{overflow-wrap:anywhere}.empty{padding:18px;font-size:.91rem;color:var(--muted)}.reading-bottom{margin:30px 0 55px}.reading-bottom>details{padding:12px 21px;border:1px solid var(--line);border-radius:8px;background:var(--white)}.reading-bottom ul{padding-left:21px;font-size:.92rem}.reading-bottom li+li{margin-top:9px}.versions{list-style:none;padding:0!important;display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:15px 0}.versions li{padding:13px 16px;border:1px solid var(--line);border-radius:6px;margin:0!important}.versions span{display:block;font-size:.78rem;color:var(--muted)}.reviewer{max-width:970px;margin:0 auto 55px}.review-top{margin-bottom:20px}.review-top label{display:block;font-size:.84rem;font-weight:650;margin-bottom:6px}.review-top select{width:100%;padding:10px 12px;border:1px solid #a6b6aa;border-radius:6px;background:var(--white)}.notice{padding:16px 19px;border:1px solid #cbd7c8;background:#edf2e9;border-radius:7px;font-size:.89rem;margin:20px 0}.notice.warning{background:#f4ecda;border-color:#d8c8a5;color:#644e22}.review-section{padding:25px;background:var(--white);border:1px solid var(--line);border-radius:9px;margin:23px 0}.review-section>p{font-size:.92rem}.review-section h2{font-size:1.28rem}.fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}.fields fieldset{min-width:0;margin:0;padding:15px;border:1px solid var(--line);border-radius:6px}.fields legend{font-size:.88rem;font-weight:650;padding:0 6px}.options{display:flex;gap:12px 16px;flex-wrap:wrap}.options label{font-size:.87rem;display:flex;gap:7px;align-items:center;cursor:pointer}.options input{accent-color:var(--green);height:17px;width:17px}.review-section>label{display:block;margin-top:19px;font-size:.9rem;font-weight:650}.review-section textarea{display:block;min-height:108px;width:100%;border:1px solid #a6b6aa;border-radius:6px;padding:12px;margin-top:7px;background:white}.action-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:19px}.action-row button{font-size:.83rem}.status{font-size:.86rem!important;color:var(--muted);margin-top:16px}.status.error{color:#893a2c}.status.success{color:var(--green)}.confirm{padding:16px;border:1px solid #d8c8a5;border-radius:7px;background:#f4ecda;margin-top:17px}.confirm button{margin-right:8px;font-size:.86rem}.confirm p{font-size:.9rem}.ai-details{font-size:.91rem;border-top:1px solid var(--line);margin-top:18px;padding-top:18px}.ai-details h3{font-size:1.05rem}.page-footer{padding:22px 0 30px;border-top:1px solid var(--line);font-size:.79rem;color:var(--muted)}.page-footer .wrap{display:flex;gap:18px;justify-content:space-between}html[data-mode=review] #reader,html[data-mode=read] #reviewer{display:none}html[data-mode=review] .reader-only{display:none}
.intro.compact{margin-bottom:17px}.intro.compact h1{font-size:1.95rem;line-height:1.3}.intro.compact .lead{margin-top:9px;font-size:.96rem}.overview{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:13px 0;margin:0 0 23px}.overview .countline{margin:0 0 8px}.overview .fine{margin:0}@media(min-width:1000px){.browser{position:sticky;top:20px}.claim-list{max-height:680px}}@media(max-width:920px){.workspace{grid-template-columns:245px minmax(0,1fr);gap:18px}.comparison{grid-template-columns:1fr}.comparison>div+div{border-left:0;border-top:1px solid var(--line)}.card{padding:22px}.mode-hint{display:none}}@media(max-width:680px){.wrap{padding:0 17px}.topbar .wrap{min-height:62px}.topbar a:last-child{font-size:.75rem}.modebar{margin:19px 0}.mode-toggle{width:100%}.mode-toggle button{flex:1;padding:8px 10px;font-size:.87rem}.lead{font-size:.96rem}.section-head{display:block}.section-head p{margin-top:7px}.workspace{grid-template-columns:1fr}.claim-list{max-height:275px}.claim-select{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px}.claim-select .title{font-size:.88rem;margin:0}.list-meta{flex-shrink:0}.list-meta .kind{display:none}.card{padding:21px 17px}.card h3{font-size:1.28rem}.comparison>div{padding:17px}.source{padding-left:13px}.source-link{font-size:.8rem}.fields,.versions{grid-template-columns:1fr}.review-section{padding:21px 17px}.action-row button{flex-grow:1}.page-footer .wrap{display:block}.page-footer p+p{margin-top:8px}.reading-bottom>details{padding:10px 16px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{html{background:white;font-size:10pt}.wrap{padding:0;width:100%}.topbar,.modebar,.browser,.action-row,.skip{display:none}.workspace{display:block}.card{break-inside:avoid}.comparison{grid-template-columns:1fr 1fr}.review-section textarea{border:1px solid #aaa}.page-footer{margin-top:20px}a{color:inherit}details:not([open])>*:not(summary){display:none}}
'''


JS = r'''
(() => {
 'use strict';
 const data=JSON.parse(document.getElementById('reader-data').textContent);
 const $=id=>document.getElementById(id), cases=new Map(data.cases.map(c=>[c.id,c]));
 const options={necessity:['필요','불필요','불확실'],meaning:['보존됨','보존되지 않음','불확실'],evidence:['충분','불충분','불확실']};
 const namespace='journal-public-reader-'+data.version;
 let selected=data.cases[0].id, filter='all', pending=null;
 let readerSeen=document.documentElement.dataset.mode!=='review', aiSeen=false, priorSeen=false, historyUnknown=false;
 const drafts=new Map(), revealed=new Set();
 try {const previous=JSON.parse(sessionStorage.getItem(namespace+'-exposure')??'null');priorSeen=previous?.seen===true;historyUnknown=previous?.unknown===true;}catch(_){historyUnknown=true;}
 function exposure(){return{readerResultsSeen:readerSeen,aiDetailsRevealed:aiSeen,previousExposureRecorded:priorSeen,previousExposureUnknown:historyUnknown,blindReviewConfirmed:false};}
 function updateExposure(){const seen=readerSeen||aiSeen||priorSeen;try{sessionStorage.setItem(namespace+'-exposure',JSON.stringify({seen,unknown:historyUnknown}));}catch(_){}
  $('exposure-notice').hidden=!(seen||historyUnknown);$('fresh-notice').hidden=seen||historyUnknown;
  $('exposure-notice').textContent=seen?'자료 읽기의 AI 판단·처리 결과 또는 비교용 AI 설명을 이미 열었습니다. 이 뒤의 입력을 AI 결과를 보지 않은 독립 평가로 간주하지 않습니다. 노출 이력은 내려받는 기록에도 남습니다.':'이전에 AI 결과를 열었는지 확인할 수 없습니다. 독립 평가 여부를 확인한 것으로 기록하지 않습니다.';
 }
 function judgments(){return Object.fromEntries(Object.keys(options).map(k=>[k,document.querySelector('input[name="'+k+'"]:checked')?.value??null]));}
 function draft(){return{judgments:judgments(),unverified:$('unverified').value,comments:$('comments').value};}
 function hasInput(d=draft()){return Object.values(d.judgments).some(v=>v!==null)||d.unverified.trim()!==''||d.comments.trim()!=='';}
 function putDraft(d){Object.keys(options).forEach(k=>document.querySelectorAll('input[name="'+k+'"]').forEach(el=>el.checked=el.value===d.judgments[k]));$('unverified').value=d.unverified;$('comments').value=d.comments;}
 const emptyDraft=()=>({judgments:Object.fromEntries(Object.keys(options).map(k=>[k,null])),unverified:'',comments:''});
 function notify(message,type=''){const el=$('review-message');el.textContent=message;el.className='status '+type;}
 function cancelPending(){pending=null;$('confirm-box').hidden=true;}
 function reviewPassage(part,node,aiConclusion=false){node.replaceChildren();const label=document.createElement('span');label.className='text-kind';const text=document.createElement('p');
  if(part.kind==='exact'&&!aiConclusion){label.textContent='공개된 실제 문구';text.textContent=part.text;}
  else{label.textContent='직접 대조 제한';text.textContent=aiConclusion?'이 항목은 이전 AI 평가의 정정 기록입니다. 평가 결과는 아래에서 직접 열기 전까지 숨깁니다.':'이 구간의 실제 문구는 공개되지 않았습니다. 요약이나 처리 결과로 원문을 대신하지 않고, 아래 원자료를 확인해 의견을 기록할 수 있습니다.';}
  node.append(label,text);
 }
 function reviewSources(c){const root=$('review-sources');root.replaceChildren();
  c.evidence.forEach(source=>{const article=document.createElement('article');article.className='source';const title=document.createElement('h4');title.textContent=source.title;const meta=document.createElement('p');meta.className='source-meta';meta.textContent=(source.source_date||'발행일 미제공')+' · '+(source.location||'세부 위치 미제공');const link=document.createElement('a');link.className='source-link';link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=/#page=\d+/.test(source.url)?'해당 PDF 쪽 열기 ↗':'원자료 열기 ↗';article.append(title,meta);
   if(source.kind==='exact_quote'&&source.text){const label=document.createElement('p');label.className='text-kind';label.textContent='공개된 원자료 직접 인용';const quote=document.createElement('blockquote');quote.textContent=source.text;article.append(label,quote);}
   else{const note=document.createElement('p');note.className='fine';note.textContent='공개된 원자료 직접 인용은 없습니다. 보고서의 요약과 해석은 이 화면에서 숨겼습니다.';article.append(note);}
   article.append(link);root.append(article);
  });
  if(!c.evidence.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='공개된 원자료 링크가 없습니다. 추가 자료가 필요합니다.';root.append(empty);}
 }
 function selectCase(id,focus=false){
  if(!cases.has(id))return;drafts.set(selected,draft());selected=id;cancelPending();
  document.querySelectorAll('.case-card').forEach(el=>el.hidden=el.dataset.id!==id);
  document.querySelectorAll('.claim-select').forEach(el=>el.setAttribute('aria-current',String(el.dataset.id===id)));
  $('review-target').value=id;const c=cases.get(id);
  reviewPassage(c.original,$('review-original'),c.status==='corrected');reviewPassage(c.proposal,$('review-proposal'),c.status==='corrected');
  reviewSources(c);
  $('review-material-limit').hidden=c.original.kind==='exact'&&c.proposal.kind==='exact'&&c.status!=='corrected';
  $('ai-case-title').textContent=c.title;$('ai-status').textContent=c.status_label;$('ai-summary').textContent=c.summary;$('ai-reason').textContent=c.reason;
  $('ai-original').textContent=c.original.text||'공개 문구 없음';$('ai-proposal').textContent=c.proposal.text||'공개 문구 없음';
  $('ai-remaining').replaceChildren(...c.remaining.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('ai-results').hidden=!revealed.has(id);$('reveal-ai').hidden=revealed.has(id);
  putDraft(drafts.get(id)??emptyDraft());notify('이 항목의 입력은 저장 버튼을 누르기 전까지 현재 화면에만 남습니다.');
  if(focus)$('heading-'+id).focus({preventScroll:true});
 }
 function mode(next,focus=true){document.documentElement.dataset.mode=next;$('reader').hidden=next!=='read';$('reviewer').hidden=next!=='review';$('read-mode').setAttribute('aria-pressed',String(next==='read'));$('review-mode').setAttribute('aria-pressed',String(next==='review'));if(next==='read'){readerSeen=true;const activeRow=document.querySelector('.claim-list li[data-id="'+selected+'"]');if(activeRow?.hidden){$('claim-search').value='';filter='all';document.querySelectorAll('[data-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.filter==='all')));applyFilter();}}updateExposure();try{const url=new URL(location.href);url.searchParams.set('mode',next);history.replaceState(null,'',url);}catch(_){}if(focus)$(next==='read'?'reader-heading':'review-heading').focus({preventScroll:true});}
 $('read-mode').addEventListener('click',()=>mode('read'));$('review-mode').addEventListener('click',()=>mode('review'));$('review-target').addEventListener('change',event=>selectCase(event.target.value));
 document.querySelectorAll('.claim-select').forEach(button=>button.addEventListener('click',()=>{selectCase(button.dataset.id,true);if(matchMedia('(max-width:680px)').matches)$('heading-'+button.dataset.id).scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}));
 document.querySelectorAll('[data-review-case]').forEach(button=>button.addEventListener('click',()=>{selectCase(button.dataset.reviewCase);mode('review');}));
 function applyFilter(){const query=$('claim-search').value.trim().toLocaleLowerCase(),visible=[];document.querySelectorAll('.claim-list li').forEach(li=>{const show=(filter==='all'||filter===li.dataset.status)&&li.dataset.search.toLocaleLowerCase().includes(query);li.hidden=!show;if(show)visible.push(li.dataset.id);});$('count-result').textContent=visible.length+'개 항목 표시';$('empty-results').hidden=visible.length>0;$('claim-content').hidden=visible.length===0;if(visible.length&&!visible.includes(selected))selectCase(visible[0]);}
 $('claim-search').addEventListener('input',applyFilter);document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));applyFilter();}));
 $('clear-search').addEventListener('click',()=>{$('claim-search').value='';filter='all';document.querySelectorAll('[data-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.filter==='all')));applyFilter();$('claim-search').focus();});
 function collect(){const c=cases.get(selected);return{schemaVersion:1,documentId:'journal-public-reader',dataVersion:data.version,researchRef:data.research_ref,reviewTarget:selected,recordType:'personal-review-draft',...draft(),exposure:exposure(),publicHumanReference:{participants:data.human_reference.participants,responses:data.human_reference.responses,unchanged:true},submitted:false,comparisonCompleted:false,actualTextPairAvailable:c.original.kind==='exact'&&c.proposal.kind==='exact'&&c.status!=='corrected',exportedAt:new Date().toISOString(),note:'개인 메모이며 연구 평가에 제출하거나 기존 사람 참고자료 건수에 더하지 않음. 이 화면 이전의 노출 이력 전체는 확인할 수 없음.'};}
 const key=()=>namespace+'-draft-'+selected;
 function ask(message,action){pending=action;$('confirm-message').textContent=message;$('confirm-box').hidden=false;$('confirm-accept').focus();}
 $('confirm-cancel').addEventListener('click',()=>{cancelPending();notify('현재 입력과 저장 기록을 유지했습니다.');});$('confirm-accept').addEventListener('click',()=>{const action=pending;cancelPending();if(action)action();});
 function validate(value){if(!value||value.schemaVersion!==1||value.documentId!=='journal-public-reader'||value.dataVersion!==data.version||value.researchRef!==data.research_ref||value.recordType!=='personal-review-draft'||!cases.has(value.reviewTarget)||!value.judgments||typeof value.unverified!=='string'||typeof value.comments!=='string'||value.unverified.length>100000||value.comments.length>100000||Object.entries(options).some(([k,values])=>value.judgments[k]!==null&&!values.includes(value.judgments[k]))||!value.exposure||['readerResultsSeen','aiDetailsRevealed','previousExposureRecorded','previousExposureUnknown','blindReviewConfirmed'].some(k=>typeof value.exposure[k]!=='boolean'))throw Error('Invalid draft');return value;}
 function restore(value){const target=value.reviewTarget;const overwrite=target===selected?hasInput():hasInput(drafts.get(target)??emptyDraft());const action=()=>{if(target!==selected)selectCase(target);putDraft(value);drafts.set(target,draft());priorSeen=priorSeen||value.exposure.readerResultsSeen||value.exposure.aiDetailsRevealed||value.exposure.previousExposureRecorded;historyUnknown=historyUnknown||value.exposure.previousExposureUnknown;updateExposure();notify('개인 메모를 복원했습니다. 연구의 기존 사람 참고자료 건수는 바뀌지 않았습니다.','success');};if(overwrite)ask('이 항목의 현재 입력을 복원한 내용으로 바꿉니다. 필요하면 먼저 파일로 내려받으세요.',action);else action();}
 $('save').addEventListener('click',()=>{if(!hasInput()){notify('입력된 판단이나 의견이 없습니다. 기존 저장 기록은 덮어쓰지 않았습니다.');return;}const save=()=>{try{localStorage.setItem(key(),JSON.stringify(collect()));notify('이 항목의 개인 메모를 이 브라우저에 저장했습니다. 연구 평가에 제출하지 않았습니다.','success');}catch(_){notify('브라우저 저장을 사용할 수 없습니다. 입력은 유지됩니다. JSON 또는 글로 내려받아 보관하세요.','error');}};try{if(localStorage.getItem(key())!==null)ask('이 항목에 저장한 메모가 있습니다. 현재 입력으로 저장 기록을 바꾸시겠어요?',save);else save();}catch(_){save();}});
 $('restore').addEventListener('click',()=>{try{const raw=localStorage.getItem(key());if(raw===null){notify('이 항목에 저장된 메모가 없습니다. 현재 입력은 유지됩니다.');return;}restore(validate(JSON.parse(raw)));}catch(_){notify('저장 기록을 읽을 수 없거나 형식이 올바르지 않습니다. 현재 입력은 유지됩니다.','error');}});
 function download(content,type,ext){let url;try{url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download='journal-'+data.version+'-'+selected+'-personal-review.'+ext;document.body.append(a);a.click();a.remove();notify('내려받기를 요청했습니다. 브라우저 다운로드 목록에서 파일을 확인하세요.','success');}catch(_){notify('내려받기를 시작하지 못했습니다. 입력은 유지됩니다. 브라우저 설정을 확인하거나 글을 복사해 보관하세요.','error');}finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}}
 $('export-json').addEventListener('click',()=>download(JSON.stringify(collect(),null,2),'application/json;charset=utf-8','json'));
 $('export-text').addEventListener('click',()=>{const value=collect(),labels={necessity:'수정 필요성',meaning:'의미 보존',evidence:'근거 충분성'};const lines=['Journal 개인 검토 메모',data.version+' / '+selected,'연구 기준: '+data.research_ref,'개인 메모이며 연구에 제출하지 않음','기존 사람 참고자료: '+data.human_reference.participants+'명 · '+data.human_reference.responses+'건 (변경 없음)','','공개 실제 문구의 대조쌍: '+(value.actualTextPairAvailable?'있음':'없음 또는 제한됨'),...Object.entries(labels).map(([k,label])=>label+': '+(value.judgments[k]??'미입력')),'','미확인 사항',value.unverified||'미입력','','자유 의견',value.comments||'미입력','','AI 노출 기록',JSON.stringify(value.exposure,null,2),'독립 평가 또는 비교 완료를 확인한 기록이 아님.','','확인할 원자료',...cases.get(selected).evidence.map(s=>s.title+' / '+s.location+'\n'+s.url),'','내려받은 시각: '+value.exportedAt];download(lines.join('\n'),'text/plain;charset=utf-8','txt');});
 $('import-json').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>1000000)throw Error('Too large');restore(validate(JSON.parse(await file.text())));}catch(_){notify('이 연구 버전의 개인 메모 파일이 아니거나 읽을 수 없습니다. 현재 입력은 유지됩니다.','error');}finally{event.target.value='';}});
 $('clear-form').addEventListener('click',()=>{if(!hasInput()){notify('이 항목의 입력은 이미 비어 있습니다.');return;}ask('이 항목의 현재 입력을 비울까요? 브라우저의 저장 기록과 AI 노출 이력은 유지됩니다.',()=>{putDraft(emptyDraft());drafts.set(selected,draft());notify('현재 입력만 비웠습니다. 저장 기록과 노출 이력은 유지됩니다.');});});
 $('reveal-ai').addEventListener('click',()=>{aiSeen=true;revealed.add(selected);$('ai-results').hidden=false;$('reveal-ai').hidden=true;updateExposure();$('ai-case-title').focus({preventScroll:true});});
 selectCase(selected);mode(document.documentElement.dataset.mode,false);applyFilter();
})();
'''


TEMPLATE = r'''<!doctype html><html lang="ko" data-mode="read"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Journal · 검증자료 읽기</title><script>try{document.documentElement.dataset.mode=new URLSearchParams(location.search).get('mode')==='review'?'review':'read'}catch(_){}</script><style>@@CSS@@</style></head><body><a class="skip" href="#main">본문 바로가기</a><header class="topbar"><div class="wrap"><a class="brand" href="@@REPO@@">Journal</a><a href="@@CURRENT_RECORD@@" target="_blank" rel="noopener noreferrer">@@VERSION@@ 연구 기록 ↗</a></div></header><main id="main" class="wrap"><div class="modebar"><div class="mode-toggle" aria-label="읽기 방식"><button type="button" id="read-mode" aria-controls="reader" aria-pressed="true">자료 읽기</button><button type="button" id="review-mode" aria-controls="reviewer" aria-pressed="false">직접 평가하기</button></div><p class="mode-hint">주장 하나에서 원문·수정·근거까지</p></div><noscript><div class="notice">JavaScript가 꺼져 있어 검색·화면 전환·개인 메모 저장을 사용할 수 없습니다. 아래의 모든 공개 검토 항목은 읽을 수 있습니다.</div></noscript>
<div id="reader"><header class="intro compact"><p class="eyebrow">현재 Git 공개 자료 · @@VERSION@@까지 반영</p><h1 id="reader-heading" tabindex="-1">@@VERSION@@ 검증자료</h1><p class="lead">항목을 고르면 수정 전후와 해당 근거를 함께 볼 수 있습니다.</p></header><section class="overview" aria-label="처리 상태와 확인 범위"><div class="countline">@@COUNTS@@</div><p class="fine">수정 반영은 기사 전체의 사실 확인을 뜻하지 않습니다. <a href="#remaining-limits">범위와 미해결 사항 보기</a></p></section><div class="section-head"><h2>원문·수정·근거 함께 읽기</h2><p>근거 링크에는 문서 제목과 확인 위치를 함께 표시합니다.</p></div><div class="workspace"><aside class="browser" aria-label="검토 항목 찾기"><div class="browser-tools"><label for="claim-search">어떤 내용을 확인할까요?</label><input id="claim-search" type="search" autocomplete="off" placeholder="PS, 발전량, 귀속…"><div class="filters" aria-label="처리 상태 필터"><button type="button" data-filter="all" aria-pressed="true">전체</button><button type="button" data-filter="applied" aria-pressed="false">반영</button><button type="button" data-filter="held" aria-pressed="false">보류</button><button type="button" data-filter="corrected" aria-pressed="false">평가 정정</button><button type="button" data-filter="unchanged" aria-pressed="false">유지</button></div></div><ul class="claim-list">@@CASE_LIST@@</ul><div id="empty-results" class="empty" hidden><p>검색한 항목이 없습니다.</p><button type="button" id="clear-search">검색과 필터 초기화</button></div><p id="count-result" class="count-result" role="status">@@CASE_COUNT@@개 항목 표시</p></aside><div id="claim-content">@@CARDS@@</div></div><div class="reading-bottom"><details id="remaining-limits"><summary>이번 자료의 범위와 미해결 사항</summary><p>@@SCOPE@@</p><ul>@@LIMITS@@</ul></details><details><summary>기존 사람 참고자료와 해석 범위</summary><p>@@HUMAN_SUMMARY@@</p><p><strong>참여자 @@HUMAN_PARTICIPANTS@@명 · 응답 @@HUMAN_RESPONSES@@건.</strong> 아래 개인 메모와 별개의 기존 기록입니다.</p><ul>@@HUMAN_LIMITS@@</ul></details><details><summary>회차별 연구 기록과 기술 정보</summary><p class="fine">이 화면은 공개 기록을 읽기 쉽게 다시 구성한 것입니다. 새 모델 실험이나 새 평가 결과를 만들지 않았습니다. 각 링크는 고정한 연구 커밋의 공개 기록으로 연결됩니다.</p><ul class="versions">@@VERSIONS@@</ul><div class="technical"><p>현재 포함 범위 @@VERSION@@까지 · 원격 기록 확인 2026.10.09 · <a href="@@COMMIT_URL@@" target="_blank" rel="noopener noreferrer">기준 커밋 @@SHORT_REF@@ ↗</a></p><p>데이터: <a href="@@DATA_URL@@" target="_blank" rel="noopener noreferrer">docs/reader-data.json</a><br>연구 기준: <code>@@REF@@</code></p><p>이 화면에는 외부 원문 전문·PDF를 복제하지 않았습니다. 인용하지 않은 문구는 ‘요약’ 또는 ‘미공개’로 표시합니다. 외부 원자료 링크는 인터넷과 해당 출처의 접근 권한이 필요합니다.</p></div></details></div></div>
<div id="reviewer" class="reviewer"><header class="intro"><p class="eyebrow">개인 검토 메모</p><h1 id="review-heading" tabindex="-1">내 판단부터 기록해 보세요.</h1><p class="lead">선택한 항목의 공개 문구와 원자료를 보고 의견을 적습니다. AI 판단·처리 결과는 아래에서 직접 열기 전까지 숨깁니다.</p></header><div class="review-top"><label for="review-target">검토할 자료</label><select id="review-target">@@REVIEW_OPTIONS@@</select></div><p id="exposure-notice" class="notice warning" hidden></p><p id="fresh-notice" class="notice">이 페이지에서는 AI 처리 결과를 아직 열지 않았습니다. 다른 곳에서 본 결과까지 확인할 수 없으므로 독립 평가를 완료한 것으로 기록하지 않습니다.</p><p class="fine">이 메모는 연구에 제출되지 않습니다. 기존 사람 참고자료인 참여자 @@HUMAN_PARTICIPANTS@@명·응답 @@HUMAN_RESPONSES@@건에 자동으로 합산하지 않습니다.</p><section class="review-section" aria-labelledby="review-material-title"><h2 id="review-material-title">공개 비교 문구와 근거</h2><p id="review-material-limit" class="notice">공개 자료에 직접 대조할 실제 문구가 부족한 항목입니다. 요약과 이전 AI 판정으로 빈칸을 채우지 않았습니다. 원자료를 확인한 뒤 의견을 기록하고, 판단이 어렵다면 ‘불확실’을 선택하세요.</p><div class="comparison"><div><h4>원문 · 공개된 구간</h4><div id="review-original"></div></div><div><h4>수정 제안 · 공개된 구간</h4><div id="review-proposal"></div></div></div><div id="review-sources"></div><p class="fine">원자료가 열리지 않거나 해당 위치를 찾지 못하면 확인한 것으로 간주하지 말고 미확인 사항에 남겨 주세요. PDF 뷰어가 해당 쪽으로 이동하지 않으면 표시한 PDF 쪽 번호를 입력하세요.</p></section><section class="review-section" aria-labelledby="personal-review-title"><h2 id="personal-review-title">내 판단</h2><p class="muted">비워 두어도 괜찮습니다. 항목을 바꾸면 현재 입력은 화면 안에 보관하지만 새로고침하면 저장하지 않은 입력은 사라집니다.</p><div class="fields">@@FIELDS@@</div><label for="unverified">미확인 사항 / 필요한 추가 자료</label><textarea id="unverified" placeholder="아직 확인하지 못한 내용과 필요한 근거를 적어 주세요."></textarea><label for="comments">자유 의견</label><textarea id="comments" placeholder="판단 이유나 더 나은 표현을 적어 주세요."></textarea><div class="action-row"><button type="button" class="primary" id="save">이 항목 저장</button><button type="button" id="restore">저장한 메모 복원</button><button type="button" id="export-json">JSON 내려받기</button><button type="button" id="export-text">글로 내려받기</button><button type="button" id="import-json">JSON 가져오기</button><button type="button" id="clear-form">입력 비우기</button><input type="file" id="import-file" hidden accept=".json,application/json" aria-label="개인 검토 JSON 파일"></div><div id="confirm-box" class="confirm" hidden><p id="confirm-message"></p><button type="button" id="confirm-accept">계속하기</button><button type="button" id="confirm-cancel">취소하고 유지</button></div><p id="review-message" class="status" role="status" aria-live="polite">아직 저장하거나 복원하지 않았습니다.</p><p class="fine">입력은 서버로 전송하지 않으며 자동 저장·자동 복원도 하지 않습니다. AI 결과를 연 이력만 같은 탭에서 새로고침해도 유지하도록 기록합니다. 브라우저 저장은 기기·열기 방식에 따라 지원되지 않거나 사라질 수 있으니 중요한 메모는 파일로도 보관하세요.</p></section><section class="review-section" aria-labelledby="ai-compare-title"><h2 id="ai-compare-title">기존 AI 판단과 비교하기</h2><p class="muted">내 판단을 적은 뒤 열어 보세요. 열었다는 이력은 기록에 남으며 비교를 완료했다는 뜻은 아닙니다.</p><button type="button" id="reveal-ai">AI 판단·처리 결과 열기</button><div id="ai-results" class="ai-details" hidden><h3 id="ai-case-title" tabindex="-1"></h3><p><strong id="ai-status"></strong></p><p id="ai-summary"></p><h4>공개 원문·이전 판단</h4><p id="ai-original"></p><h4>공개 수정·현재 처리</h4><p id="ai-proposal"></p><h4>처리 이유</h4><p id="ai-reason"></p><h4>남은 한계</h4><ul id="ai-remaining"></ul></div></section></div></main><footer class="page-footer"><div class="wrap"><p>Journal · 공개 기록에서 만든 근거 대조 화면</p><p>@@VERSION@@ 연구 묶음 · 일반 성능이나 사람 평가 완료의 인증이 아닙니다.</p></div></footer><script id="reader-data" type="application/json">@@DATA@@</script><script>@@JS@@</script></body></html>'''


def render(data):
    cards, items = [], []
    ref = data['research_ref']
    for case in data['cases']:
        cid = case['id']
        kind = '실제 문구' if case['original']['kind'] == case['proposal']['kind'] == 'exact' else '공개 범위 제한'
        items.append(f'<li data-id="{e(cid)}" data-status="{e(case["status"])}" data-search="{e(" ".join([cid,case["title"],case["summary"],case["reason"]]))}"><button class="claim-select" type="button" data-id="{e(cid)}" aria-current="false" aria-controls="case-{e(cid)}"><span class="title">{e(case["title"])}</span><span class="list-meta"><span class="badge {e(case["status"])}">{e(case["status_label"])}</span><span class="kind">{kind}</span></span></button></li>')
        previous, current = ('이전 AI 평가', '정정한 AI 평가') if case['status'] == 'corrected' else ('기사 원문 · 공개된 구간', '수정 제안 · 현재 처리')
        remaining = ''.join('<li>' + e(text) + '</li>' for text in case['remaining'])
        cards.append(f'''<article class="card case-card" data-id="{e(cid)}" id="case-{e(cid)}" aria-labelledby="heading-{e(cid)}"><div class="card-heading"><span class="badge {e(case['status'])}">{e(case['status_label'])}</span><span class="fine">저장된 연구 결과</span></div><h3 id="heading-{e(cid)}" tabindex="-1">{e(case['title'])}</h3><p class="card-summary">{e(case['summary'])}</p><div class="comparison"><div><h4>{previous}</h4>{passage(case['original'])}</div><div><h4>{current}</h4>{passage(case['proposal'])}</div></div><div class="reason"><h4>이렇게 처리한 이유</h4><p>{e(case['reason'])}</p></div><h4>원자료에서 확인할 부분</h4><div id="sources-{e(cid)}">{evidence_markup(case)}</div><div class="remaining"><h4>아직 남은 내용</h4><ul>{remaining or '<li>이 항목의 추가 한계는 연구 기록과 전체 범위 설명을 확인하세요.</li>'}</ul></div><button type="button" data-review-case="{e(cid)}">이 항목에 대한 내 판단 기록하기</button><details class="technical"><summary>기록 위치와 항목 정보</summary><p>항목 ID: {e(cid)} · 연구 묶음 {e(data['version'])}</p><a href="{e(record_url(case['record_path'],ref))}" target="_blank" rel="noopener noreferrer">이 판단의 공개 기록 열기 ↗</a><p>정정·보류·유지는 서로 다른 상태입니다. 원자료에서 의미를 보존했다는 판단과 외부 사실의 진실성 확인을 같은 결과로 세지 않습니다.</p></details></article>''')
    filters = {'applied':'수정 반영','held':'보류','corrected':'평가 정정','unchanged':'유지'}
    counts = ''.join(f'<span class="badge {key}">{label} {sum(c["status"]==key for c in data["cases"])}</span>' for key,label in filters.items())
    fields = ''
    for name, label, values in [('necessity','수정 필요성',['필요','불필요','불확실']),('meaning','의미 보존',['보존됨','보존되지 않음','불확실']),('evidence','근거 충분성',['충분','불충분','불확실'])]:
        fields += f'<fieldset><legend>{label}</legend><div class="options">' + ''.join(f'<label><input type="radio" name="{name}" value="{value}"> {value}</label>' for value in values) + '</div></fieldset>'
    version_labels = {'historical':'이전 연구 기록','current':'이번 자료의 기준','parallel':'별도 후속 연구'}
    versions = ''.join(f'<li><a href="{e(record_url(v["path"],ref))}" target="_blank" rel="noopener noreferrer">{e(v["version"])} · {e(v["title"])}</a><span>{e(version_labels.get(v["status"],v["status"]))}</span></li>' for v in data['versions'] if v['status'] != 'excluded')
    current_record = next((v['path'] for v in data['versions'] if v['version']==data['version']), 'README.md')
    embedded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    values = {
        'CSS':CSS,'JS':JS,'DATA':embedded,'REPO':REPO_URL,'CURRENT_RECORD':e(record_url(current_record,ref)),
        'VERSION':e(data['version']),'SCOPE':e(data['scope']),'REF':e(ref),'SHORT_REF':ref[:10],
        'COMMIT_URL':f'{REPO_URL}/commit/{ref}','COUNTS':counts,
        'CASE_LIST':''.join(items),'CARDS':''.join(cards),'CASE_COUNT':str(len(cards)),
        'LIMITS':''.join('<li>'+e(v)+'</li>' for v in data['limits']),
        'HUMAN_SUMMARY':e(data['human_reference']['summary']),
        'HUMAN_PARTICIPANTS':str(data['human_reference']['participants']),
        'HUMAN_RESPONSES':str(data['human_reference']['responses']),
        'HUMAN_LIMITS':''.join('<li>'+e(v)+'</li>' for v in data['human_reference']['limits']),
        'VERSIONS':versions,'DATA_URL':f'{REPO_URL}/blob/main/docs/reader-data.json',
        'REVIEW_OPTIONS':''.join(f'<option value="{e(c["id"])}">{i+1:02d} · {e(REVIEW_TITLES.get(c["id"],c["title"]))}</option>' for i,c in enumerate(data['cases'])),
        'FIELDS':fields,
    }
    page = re.sub(r'@@([A-Z_]+)@@', lambda match: values[match.group(1)], TEMPLATE)
    if re.search(r'@@[A-Z_]+@@', page):
        raise AssertionError('Unrendered placeholder')
    return page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail when generated HTML differs from source data')
    args = parser.parse_args()
    page = render(read_data())
    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding='utf-8') != page:
            raise SystemExit('Reader HTML is missing or stale. Run python tools/build_reader.py.')
        print('Public reader matches checked source data.')
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(page, encoding='utf-8')
        print(f'Built {OUTPUT_PATH.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
