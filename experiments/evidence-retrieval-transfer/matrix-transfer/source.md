# Annual electricity generation by energy source

The Korea Energy Agency’s 재생에너지센터 publishes the table under 자료실 → 통계자료 → 보급통계 → 발전량 → 연도별 발전량. The HTML table lists energy sources vertically and years horizontally. Its unit is MWh. The version inspected on 2026-11-25 contains the years 2017–2024. The table has no displayed revision date. [Official table](https://www.knrec.or.kr/biz/statistics/supply/supply02_01_list.do)

The extract keeps the most recent four years in that version (2021–2024) and four consecutive energy-source rows. The original table also includes 2017–2020, summary rows, and four further energy sources. Those columns and rows were omitted to keep a small rectangular excerpt. Each retained label and value was copied from its HTML cell, preserving the original order and thousands separators.

Coordinates below start at 1 and count the header as the first row and the row-label column as the first column. The reference values were checked directly against the HTML cells before running the retrieval experiment.

| Probe | Source row and year | Original (row, col) | Extract (row, col) | MWh |
| --- | --- | --- | --- | ---: |
| M01 | 태양광, 2021 | (10, 6) | (2, 2) | 24,717,623 |
| M02 | 풍력, 2024 | (11, 9) | (3, 5) | 3,736,569 |
| M03 | 해양, 2023 | (13, 8) | (5, 4) | 437,567 |
| M04 | 수력, 2022 | (12, 7) | (4, 3) | 3,544,866 |

M04 quotes the adjacent 풍력 cell immediately above the target in the same year (3,369,458 MWh). M05 asks for the offshore portion of wind generation. The wind row aggregates generation and gives no onshore/offshore breakdown. M06 asks for 2025, while the source table and the extract both end in 2024. Neither control has a supporting cell.

SHA-256 of the five UTF-8 TSV lines joined with LF and ending in LF is `75b499b1fc4a8d5aaae2ed18f82609c4910cccf08461c71ea5a2b3c35c223c4e`.
