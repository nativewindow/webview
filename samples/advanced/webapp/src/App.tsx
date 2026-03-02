import { useState } from "react";
import { useChannelEvent, useSend } from "./channel";
import TodoList from "./TodoList.tsx";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  const send = useSend();

  useChannelEvent("counter", (counter) => {
    console.log("Received counter update:", counter);
    setCount(counter);
  });

  return (
    <>
      <h1>Vite + Native Window</h1>
      <div className="card">
        <button onClick={() => send("setCounter", count + 1)}>count is {count}</button>
        <button onClick={() => send("randomize")}>randomize counter</button>
      </div>
      <TodoList />
    </>
  );
}

export default App;
