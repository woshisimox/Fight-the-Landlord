
import React from 'react';

const IndexPage = () => {
  return (
    <div style={{ marginTop: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <button>开始</button>
        <button>停止</button>
        <span>剩余局数: 10</span>
      </div>
    </div>
  );
};

export default IndexPage;
