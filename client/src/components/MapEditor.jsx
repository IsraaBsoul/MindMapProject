import React, { useState, useCallback, useEffect, useRef } from "react"; 
import ReactFlow, {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import io from "socket.io-client";
import { useNavigate } from "react-router-dom";
import ParticipantBox from "./ParticipantBox";
import { getAuth } from "firebase/auth";

const auth = getAuth();
const currentUserId = auth.currentUser?.uid;

const socket = io("http://localhost:5000");

const initialNodes = [
  {
    id: "1",
    data: { label: "Node 1" },
    position: { x: 250, y: 5 },
    style: { border: "2px solid #000000" },
    
  },
];

const initialEdges = [];

const MapEditor = ({ mapId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [nodeId, setNodeId] = useState(2);
  const [mapName, setMapName] = useState("");
  const [mapDescription, setMapDescription] = useState("");
  const [selectedElements, setSelectedElements] = useState([]);
  const [firebaseInitialized, setFirebaseInitialized] = useState(false);
  const [mapCreator, setMapCreator] = useState(""); // To store the creator's username
  const [lastEdited, setLastEdited] = useState(""); // To store the last edited timestamp
  const [selectedNode, setSelectedNode] = useState(null); // To store the currently selected node
  const [borderColor, setBorderColor] = useState("#000000"); // Default border color
  const [textColor, setTextColor] = useState("#000000");
  

  // Refs to track previous state
  const prevNodesRef = useRef(nodes);
  const prevEdgesRef = useRef(edges);

  const navigate = useNavigate();
  // Ref to store previous data from Firebase to compare and avoid unnecessary updates
  const prevMapDataRef = useRef(null);

    // Function to refresh the page
    const refreshPage = () => {
      window.location.reload();
    };

  const updateFirebase = useCallback(
    (newNodes, newEdges) => {
      if (!firebaseInitialized) return; // Avoid updating Firebase before initialization
      console.log("Updating Firebase with nodes:", newNodes);
      console.log("Edges:", newEdges);
      // Only update if nodes or edges have actually changed
      if (JSON.stringify(newNodes) !== JSON.stringify(prevNodesRef.current) || 
          JSON.stringify(newEdges) !== JSON.stringify(prevEdgesRef.current)) {
        const mapRef = doc(db, "maps", mapId);
        updateDoc(mapRef, {
          nodes: newNodes,
          edges: newEdges,
          name: mapName,
          description: mapDescription,
          lastEdited: new Date(),
        }).catch((err) => console.error("Firebase update failed:", err));
        
        // Update refs to current values
        prevNodesRef.current = newNodes;
        prevEdgesRef.current = newEdges;
      }
    },
    [firebaseInitialized, mapId, mapName, mapDescription]
  );

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        const updatedEdges = addEdge(params, eds);
        updateFirebase(nodes, updatedEdges); // update Firebase only when there's a real change
        return updatedEdges;
      });
      socket.emit("edge-added", params);
    },
    [nodes, updateFirebase]
  );

  const handleSelectionChange = useCallback((elements) => {
    const newSelectedElements = elements && Array.isArray(elements) ? elements.map((el) => el.id) : [];
    
    // Only update state if selected elements have changed
    if (JSON.stringify(newSelectedElements) !== JSON.stringify(selectedElements)) {
      setSelectedElements(newSelectedElements);
    }
  }, [selectedElements]);

  const handleNodeChanges = useCallback(
    (changes) => {
      setNodes((nds) => {
        const updatedNodes = applyNodeChanges(changes, nds);
        updateFirebase(updatedNodes, edges); // update Firebase only when there's a real change
        return updatedNodes;
      });
    },
    [edges, updateFirebase]
  );

  const handleEdgeChanges = useCallback(
    (changes) => {
      setEdges((eds) => {
        const updatedEdges = applyEdgeChanges(changes, eds);
        updateFirebase(nodes, updatedEdges); // update Firebase only when there's a real change
        return updatedEdges;
      });
    },
    [nodes, updateFirebase]
  );

  const addNode = useCallback(() => {
    console.log("Adding Node with ID:", nodeId);
    const newNodeId = nodes.length ? Math.max(...nodes.map((node) => parseInt(node.id))) + 1 : 1;

    const newNode = {
      id: newNodeId.toString(),
      data: { label: `Node ${newNodeId}` },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      style: { border: `2px solid ${borderColor}` }, 
    };
    console.log("New Node Created:", newNode);
    setNodes((nds) => {
      
      const updatedNodes = [...nds, newNode];
      console.log("Updated Nodes:", updatedNodes);
      updateFirebase(updatedNodes, edges); // update Firebase only when there's a real change
      return updatedNodes;
    });
    setNodeId((id) => id + 1);
    socket.emit("node-added", newNode);
  }, [nodeId, edges, updateFirebase , borderColor]);

  const onNodeDoubleClick = useCallback(
    (event, node) => {
      const newLabel = window.prompt("Enter new label for the node:", node.data.label);
      if (newLabel !== null) {
        setNodes((nds) => {
          const updatedNodes = nds.map((n) =>
            n.id === node.id ? { ...n, data: { ...n.data, label: newLabel } } : n
          );
          updateFirebase(updatedNodes, edges); // update Firebase only when there's a real change
          return updatedNodes;
        });
        socket.emit("node-renamed", { id: node.id, label: newLabel });
      }
    },
    [edges, updateFirebase]
  );

  const onDelete = useCallback(() => {
    const remainingNodes = nodes.filter((node) => !selectedElements.includes(node.id));
    const remainingEdges = edges.filter((edge) => !selectedElements.includes(edge.id));
    setNodes(remainingNodes);
    setEdges(remainingEdges);
    setSelectedElements([]);
    updateFirebase(remainingNodes, remainingEdges); // update Firebase only when there's a real change
    socket.emit("elements-deleted", selectedElements);
  }, [nodes, edges, selectedElements, updateFirebase]);

  useEffect(() => {
    const mapRef = doc(db, "maps", mapId);

    const unsubscribe = onSnapshot(mapRef, (doc) => {
      if (doc.exists()) {
        const mapData = doc.data();

        // Check if map data is different before updating state
        if (
          !prevMapDataRef.current ||
          JSON.stringify(prevMapDataRef.current.nodes) !== JSON.stringify(mapData.nodes) ||
          JSON.stringify(prevMapDataRef.current.edges) !== JSON.stringify(mapData.edges) ||
          prevMapDataRef.current.name !== mapData.name ||
          prevMapDataRef.current.description !== mapData.description
        ) {
          setNodes(mapData.nodes || []);
          setEdges(mapData.edges || []);
          setMapName(mapData.name || "");
          setMapDescription(mapData.description || "");
          setLastEdited(mapData.lastEdited?.toDate().toLocaleString() || "Not available");
          setMapCreator(mapData.creator || "Unknown");
          setFirebaseInitialized(true); // Firebase data is now loaded
          prevMapDataRef.current = mapData; // Update ref with new data
        }
      }
    });

    return () => unsubscribe();
  }, [mapId]); // Only re-run when mapId changes

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        onDelete();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDelete]);


  // Handle node click to select it
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node); // Set the selected node
    setBorderColor(node.style?.border?.split(" ")[2] || "#000000"); // Extract the current border color
  }, []);

  // Update the selected node's border color
  const handleBorderColorChange = (color) => {
    if (selectedNode) {
      const updatedNodes = nodes.map((node) =>
        node.id === selectedNode.id
          ? { ...node, style: { ...node.style, border: `2px solid ${color}` } }
          : node
      );
      setNodes(updatedNodes);
      setBorderColor(color);
      updateFirebase(updatedNodes, edges); // Update Firebase with the new color
    }
  };

  

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex" }}>
      <div style={{ width: "80%", height: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodeChanges}
          onEdgesChange={handleEdgeChanges}
          
          onConnect={onConnect}
          
          
          onNodeClick={onNodeClick} // Handle node click
          onSelectionChange={handleSelectionChange} // Use the optimized selection handler
          onNodeDoubleClick={onNodeDoubleClick}
          selectNodesOnDrag
          fitView
        />
      </div>

      <div style={{ width: "20%", padding: "10px", background: "#f4f4f4" }}>
        <h3>Map Details</h3>
        
        <button onClick={addNode} style={{ marginBottom: "10px" }}>Add Node</button>
        {/* <button onClick={onDelete} style={{ marginBottom: "10px" }}>Delete Selected</button> */}
        <button onClick={refreshPage} style={{ marginBottom: "10px" }}>
          Home Page
        </button>
        <div>
          <label style={{ color: "#388e3c" }}>Map Name:</label>
          <input
            type="text"
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            onBlur={() => updateFirebase(nodes, edges)}
            placeholder="Enter map name"
            style={{ width: "100%", marginBottom: "10px" }}
          />
        </div>
        <div>
          <label style={{ color: "#388e3c" }}>Map Description:</label>
          <textarea
            value={mapDescription}
            onChange={(e) => setMapDescription(e.target.value)}
            onBlur={() => updateFirebase(nodes, edges)}
            placeholder="Enter map description"
            style={{ width: "100%", height: "100px" }}
          />
        </div>
        <div>
          <label style={{ color: "#388e3c" }}>Map ID:</label>
          <p>{mapId}</p>
        </div>
        <div>
          <label style={{ color: "#388e3c" }}>Last Edited:</label>
          <p>{lastEdited}</p>
        </div>
        {/* Color Picker for Selected Node's Border */}
        {selectedNode && (
          <div>
            <label>Selected Node Border Color:</label>
            <input
              type="color"
              value={borderColor}
              onChange={(e) => handleBorderColorChange(e.target.value)} // Change border color
              style={{ width: "100%" }}
            />
          </div>
        )}
        <ParticipantBox mapId={mapId} currentUserId={currentUserId} />

      </div>
    </div>
  );
};

const MapEditorWithParams = ({ mapId }) => (
  <ReactFlowProvider>
    <MapEditor mapId={mapId} />
  </ReactFlowProvider>
);

export default MapEditorWithParams;