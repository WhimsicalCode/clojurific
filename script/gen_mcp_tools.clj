;; Writes src/main/js/cljf/mcp-tools.json from cljf.esm.mcp/tools, run by
;; script/gen-mcp-tools.

(require '[cljf.esm.mcp :as mcp]
         '[cljs.vendor.clojure.data.json :as json])

(spit "src/main/js/cljf/mcp-tools.json"
  (str (json/write-str mcp/tools :indent true :escape-slash false) "\n"))

(println "Wrote src/main/js/cljf/mcp-tools.json," (count mcp/tools) "tools")
(shutdown-agents)
