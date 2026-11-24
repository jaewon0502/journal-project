# Road traffic statistics source note

한국도로교통공단 published the 20251231 edition of its five-year road traffic accident dataset on the Korean Public Data Portal. The catalog records 2026-08-04 as both publication and modification date and lists the release as free with unrestricted reuse (이용허락범위 제한 없음). The file covers police-investigated crashes involving injury or death. [Official catalog metadata](https://www.data.go.kr/catalog/15070339/fileData.json)

On 2026-11-25 KST, the source preparer opened the official file page and checked all six column headings and all five data rows in the rendered 미리보기 table. The frozen lines preserve column order, values, and year order. Tabs replace cell boundaries. Line numbers start at one and count the header. The highlighted file edition matters because the portal lists older releases on the same page. [Original table](https://www.data.go.kr/data/15070339/fileData.do#tab-layer-file-04)

Four queries ask for different year rows. One proposes a death count taken from a neighboring year to test whether the retriever finds the row that checks the claim. A fifth asks for the same crash-count measure in 2020. The five published rows cover 2021 through 2025, so the frozen table supplies no row for that year. This control tests abstention within the supplied table.

The source preparer chose the questions and one-based labels before any retrieval run, without consulting the search implementation or its tests. The check covers row selection for one table and does not evaluate extraction of the requested cell.
