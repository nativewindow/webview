import { useLiveQuery } from "@tanstack/react-db";
import { todoCollection } from "./todos.ts";

function TodoList() {
  const { data: todos } = useLiveQuery((q) => q.from({ todo: todoCollection }));

  return (
    <div className="card todo">
      <h2>TanStack DB Todos</h2>
      <p style={{ opacity: 0.6, marginTop: -8 }}>synced from host via native-window-tsdb</p>
      {todos.length === 0 ? (
        <p style={{ opacity: 0.4 }}>waiting for data...</p>
      ) : (
        <ul style={{ textAlign: "left", listStyle: "none", padding: 0 }}>
          {todos.map((todo) => (
            <li key={todo.id} style={{ padding: "4px 0" }}>
              <span style={{ marginRight: 8 }}>{todo.done ? "\u2705" : "\u2B1C"}</span>
              <span
                style={{
                  textDecoration: todo.done ? "line-through" : "none",
                  opacity: todo.done ? 0.5 : 1,
                }}
              >
                {todo.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p style={{ opacity: 0.4, fontSize: 12 }}>
        {todos.length} item{todos.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

export default TodoList;
