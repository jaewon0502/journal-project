# Bank of Korea base-rate excerpt

Primary source: Bank of Korea, 한국은행 기준금리 추이
https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSecd=00001&menuNo=200643

Inspected the rendered table and the underlying HTML table on 2026-11-25 KST. The 11 consecutive observations run from 2023-01-13 through 2020-05-28 in the source's descending order. The website gives each observation its own year, month/day, and rate cells. The fixture joins the date cells with the Korean year suffix, keeps the displayed zero padding and decimal precision, and separates the date and rate with a vertical bar. The original headers are 변경일자 and 기준금리. The graph description on that page supplies the percent unit included in the fixture header.

Fixture line 1 is the header. The four answerable questions point to lines 9, 8, 6, and 10 respectively. The April question deliberately borrows the January rate. The 2020-03-17 row immediately below the selected slice is excluded and has no supporting line in the fixture. Questions and line labels were set before any contact with the evidence retrieval implementation or its results.

SHA-256 of the JSON file (UTF-8, LF): f4dbf796a94f0d7f504d140d925307dfa4fcb31eb78ef049b8d2dfe714c37b78
