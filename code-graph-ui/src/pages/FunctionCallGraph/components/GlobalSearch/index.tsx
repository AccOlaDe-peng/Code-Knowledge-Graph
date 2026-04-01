/**
 * GlobalSearch - 全局搜索组件
 *
 * 支持函数名模糊搜索，点击跳转到函数详情
 */
import React, { useState, useMemo, useCallback } from "react";
import { Input, Empty } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useFunctionCallStore } from "../../../../store/functionCallStore";

const GlobalSearch: React.FC = () => {
  const { data, setSelectedModule, setSelectedFunction, funcToModuleIndex } = useFunctionCallStore();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ funcId: string; name: string; moduleName: string }>>([]);
  const [showResults, setShowResults] = useState(false);

  // 搜索函数
  const doSearch = useCallback(
    (text: string) => {
      if (!text || !data?.modules) {
        setResults([]);
        return;
      }

      const searchLower = text.toLowerCase();
      const matches: Array<{ funcId: string; name: string; moduleName: string }> = [];

      for (const module of data.modules) {
        for (const func of module.functions) {
          if (
            func.name.toLowerCase().includes(searchLower) ||
            func.fullName.toLowerCase().includes(searchLower) ||
            func.className.toLowerCase().includes(searchLower)
          ) {
            matches.push({
              funcId: func.id,
              name: func.name,
              moduleName: module.name,
            });
            if (matches.length >= 20) break;
          }
        }
        if (matches.length >= 20) break;
      }

      setResults(matches);
    },
    [data]
  );

  // 防抖搜索
  const debouncedSearch = useMemo(
    () => {
      let timeout: ReturnType<typeof setTimeout>;
      return (text: string) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => doSearch(text), 300);
      };
    },
    [doSearch]
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    setShowResults(true);
    debouncedSearch(value);
  };

  const handleSelect = (funcId: string) => {
    const module = funcToModuleIndex?.get(funcId);
    if (module) {
      setSelectedModule(module.id);
    }
    setSelectedFunction(funcId);
    setShowResults(false);
    setSearch("");
    setResults([]);
  };

  return (
    <div style={{ position: "relative" }}>
      <Input
        placeholder="搜索函数..."
        prefix={<SearchOutlined style={{ color: "#5a6a8a" }} />}
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        onFocus={() => search && setShowResults(true)}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        style={{
          width: 200,
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 4,
        }}
        allowClear
      />

      {/* 搜索结果下拉 */}
      {showResults && results.length > 0 && (
        <div style={styles.dropdown}>
          {results.map((r) => (
            <div
              key={r.funcId}
              onClick={() => handleSelect(r.funcId)}
              style={styles.resultItem}
            >
              <span style={styles.resultName}>{r.name}</span>
              <span style={styles.resultModule}>{r.moduleName}</span>
            </div>
          ))}
        </div>
      )}

      {showResults && search && results.length === 0 && (
        <div style={styles.dropdown}>
          <Empty
            description={<span style={{ color: "#5a6a8a", fontSize: 12 }}>无匹配结果</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    background: "rgba(10,13,20,0.98)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    maxHeight: 300,
    overflow: "auto",
    zIndex: 1000,
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  },
  resultItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },
  resultName: {
    fontSize: 12,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
  },
  resultModule: {
    fontSize: 10,
    color: "#5a6a8a",
  },
};

export default GlobalSearch;
