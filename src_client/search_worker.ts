// did you know? firefox doesn't support es6 modules in web workers as of 2022-01-16 -_-

// import { FurryIndex } from "furry-text-search";
// import { ServiceAlert } from "./protocol";
// import { isDoSearch, isNewData, SearchWorkerRequest, SEARCH_KEYS, SEARCH_THRESHOLD, SORT_COMPARE_FUNC } from "./search_worker_data"

// let searchIndex: FurryIndex<ServiceAlert> = null;

// addEventListener('message', e => {
//     const data = e.data as SearchWorkerRequest;

//     if (isNewData(data)) {
//         if (!data?.alerts?.length) {
//             searchIndex = null;
//         } else {
//             searchIndex = new FurryIndex<ServiceAlert>(data.alerts, SEARCH_KEYS, SORT_COMPARE_FUNC);
//         }
//     } else if (isDoSearch(data)) {
//         const results = searchIndex.search(data.queries, SEARCH_THRESHOLD, false);

//         postMessage({
//             id: data.id,
//             results
//         });
//     }
// });