import React, { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, doc, deleteDoc, query, where, getDocs, updateDoc, setDoc, arrayUnion, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import MapEditor from "./MapEditor";
import { signOut, updateProfile } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import io from "socket.io-client";
import "../styles/Dashboard.css";

const Dashboard = ({ user }) => {
  const [maps, setMaps] = useState([]);
  const [selectedMapId, setSelectedMapId] = useState(null);
  const [newMapName, setNewMapName] = useState("");
  const [joinMapName, setJoinMapName] = useState("");
  const [joinMapId, setJoinMapId] = useState("");
  const [isCreateInputVisible, setIsCreateInputVisible] = useState(false);
  const [isJoinInputVisible, setIsJoinInputVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState({ isVisible: false, mapId: null, mapName: "" });

  const [showProfileDetails, setShowProfileDetails] = useState(false);
  const [username, setUsername] = useState(user.displayName || "");
  const [profilePicture, setProfilePicture] = useState(user.photoURL || "");
  const [email, setEmail] = useState(user.email || "");
  const [error, setError] = useState("");
  const [joinSuccessMessage, setJoinSuccessMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState(""); // State for search term
  const [allMaps, setAllMaps] = useState([]); // Store all maps fetched from Firebase
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const colRef = collection(db, "maps");
    const q = query(colRef, where("participants", "array-contains", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userMaps = [];
      snapshot.forEach((doc) => {
        userMaps.push({ id: doc.id, ...doc.data() });
      });
      setMaps(userMaps);
    });
    return () => unsubscribe();
  }, [user.uid]);
  useEffect(() => {
    const colRef = collection(db, "maps");
    const q = query(colRef, where("participants", "array-contains", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userMaps = [];
      snapshot.forEach((doc) => {
        userMaps.push({ id: doc.id, ...doc.data() });
      });
      setAllMaps(userMaps); // Store all maps in allMaps
      setMaps(userMaps); // Initialize displayed maps
    });
    return () => unsubscribe();
  }, [user.uid]);
  const handleSearch = (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);

    if (term === "") {
        setMaps(allMaps)
        return
    }

    const filteredMaps = allMaps.filter((map) =>
      map.name.toLowerCase().includes(term)
    );
    setMaps(filteredMaps);
  };
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const userRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          setProfilePicture(userData.profilePicture || ""); // Set the profile picture
          setUsername(userData.username || "");
          setEmail(userData.email || "");
        }
      } catch (error) {
        console.error("Error fetching user profile:", error);
        setError("Failed to load profile data. Please try again.");
      }
    };

    const newSocket = io('http://localhost:5000');
    setSocket(newSocket);

    newSocket.on('newMapCreated', (newMap) => {
      setMaps((prevMaps) => [...prevMaps, newMap]);
      //console.log('New map created:', newMap);
    });

    fetchUserProfile();

    return () => {
      newSocket.disconnect();
    };
  }, [user]);

  function resizeAndCompressImage(file, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function () {
            const canvas = document.createElement("canvas");
            const maxWidth = 100;  // Smaller max width
            const maxHeight = 100; // Smaller max height
            let width = img.width;
            let height = img.height;

            // Scale down while keeping the aspect ratio
            if (width > maxWidth || height > maxHeight) {
                if (width > height) {
                    height *= maxWidth / width;
                    width = maxWidth;
                } else {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to Base64 (JPEG format with 50% quality)
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.5);

            // Ensure the Base64 string is within Firebase's limit
            if (compressedBase64.length > 1000) {
                callback(null, "Compressed image is still too large.");
            } else {
                callback(compressedBase64, null);
            }
        };
    };
}
const handleFileChange = async (e) => {
  const file = e.target.files[0];

  if (!file) {
      setError("No file selected.");
      return;
  }

  const validExtensions = [".jpg", ".jpeg", ".png"];
  const fileName = file.name.toLowerCase();
  const isValidExtension = validExtensions.some((ext) => fileName.endsWith(ext));

  if (!isValidExtension) {
      setError("Please upload a valid image file (.jpg, .jpeg, .png).");
      return;
  }

  try {
      // Resize & compress before saving
      resizeAndCompressImage(file, async (compressedBase64, error) => {
          if (error) {
              setError("Image too large after compression. Try a smaller file.");
              return;
          }

          // Save the Base64 string in Firestore
          const userRef = doc(db, "users", user.uid);
          await updateDoc(userRef, { profilePicture: compressedBase64 });

          // Update Firebase Authentication with an empty photoURL (to avoid the error)
          await updateProfile(auth.currentUser, { photoURL: "" });

          // Update UI with new profile picture
          setProfilePicture(compressedBase64);
          setError("");
      });

  } catch (error) {
      console.error("Error processing file:", error);
      setError("Failed to process the file. Please try again.");
  }
};


  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const usersQuery = query(collection(db, "users"), where("username", "==", username));
      const existingUsers = await getDocs(usersQuery);
      if (!existingUsers.empty) {
        const matchingUser = existingUsers.docs.find((doc) => doc.id !== user.uid);
        if (matchingUser) {
          setError("Username is already taken. Please choose another one.");
          return;
        }
      }
      if (auth.currentUser) {
        const profileData = {
          displayName: username,
          photoURL: profilePicture,
        };
        await updateProfile(auth.currentUser, profileData);
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { username });
        //alert("Profile updated successfully!");
        setShowProfileDetails(false);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const createNewMap = async (e) => {
    e.preventDefault();
    if (!newMapName.trim()) return;
    try {
      const docRef = await addDoc(collection(db, "maps"), {
        name: newMapName,
        nodes: [],
        edges: [],
        userId: user.uid,
        participants: [user.uid],
        createdAt: new Date()
      });
      //console.log("New map created with ID:", docRef.id);
      setNewMapName("");
      setSelectedMapId(docRef.id);
      if (socket) {
        socket.emit('mapCreated', { id: docRef.id, name: newMapName });
      }
      setIsCreateInputVisible(false);
    } catch (err) {
      console.error("Error creating map:", err.message);
    }
  };

  const handleDeleteClick = (mapId, mapName) => {
    setConfirmDelete({ isVisible: true, mapId, mapName });
  };

  const confirmDeleteMap = async () => {
    const { mapId } = confirmDelete;
    try {
      await deleteDoc(doc(db, "maps", mapId));
      setMaps((prevMaps) => prevMaps.filter((map) => map.id !== mapId));
      //console.log(`Map with ID: ${mapId} deleted.`);
      setConfirmDelete({ isVisible: false, mapId: null, mapName: "" });
    } catch (err) {
      //console.error("Error deleting map:", err.message);
    }
  };

  const cancelDelete = () => {
    setConfirmDelete({ isVisible: false, mapId: null, mapName: "" });
  };

  const joinMap = async (e) => {
    e.preventDefault();
    setJoinSuccessMessage("");
    setError("");

    if (!joinMapName.trim() || !joinMapId.trim()) {
      setError("Please provide both the map name and ID.");
      return;
    }

    try {
      const mapDocRef = doc(db, "maps", joinMapId);
      const mapDocSnap = await getDoc(mapDocRef);

      if (mapDocSnap.exists()) {
        const mapData = mapDocSnap.data();

        if (mapData.name === joinMapName) {
          if(mapData.participants && mapData.participants.includes(user.uid)) {
            setJoinSuccessMessage("You have already joined this map.");
          } else {
            await updateDoc(mapDocRef, {
              participants: arrayUnion(user.uid),
            });
            setJoinSuccessMessage("You have successfully joined the map.");
            setJoinMapName("");
            setJoinMapId("");
          }
        } else {
          setError("The map name does not match the provided ID.");
        }
      } else {
        setError("No map found with the provided ID.");
      }
    } catch (err) {
      console.error("Error joining map:", err.message);
      setError("An error occurred while trying to join the map. Please try again.");
    }
  };

  const cancelJoinMap = () => {
    setJoinMapName("");
    setJoinMapId("");
    setIsJoinInputVisible(false);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      //console.log("User logged out successfully!");
      navigate("/");
    } catch (error) {
      //console.error("Error logging out: ", error.message);
    }
  };

  if (selectedMapId) {
    return <MapEditor mapId={selectedMapId} />;
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="user-info">
            <img src={profilePicture} alt="Profile" className="profile-picture" />
            <h2 style={{color:"#2C5F2D" }}>Hi {username || "User"} ;)</h2>
            <button
              className="details-button"
              onClick={() => setShowProfileDetails(true)}
            >
              User Details
            </button>
          </div>
        </div>
        <div className="header-right">
          <button className="card-button logout-button" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      </header>

      {showProfileDetails && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Your Profile</h2>
              <button
                className="close-button"
                onClick={() => setShowProfileDetails(false)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleProfileUpdate} className="profile-form">
              <div className="form-group">
                <label>Email:</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Username:</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Profile Picture:</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="form-input"
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="form-actions">
                <button type="submit" className="action-button">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="button-container">
        {!isCreateInputVisible && (
          <button className="card-button" onClick={() => setIsCreateInputVisible(true)}>
            Create New Map
          </button>
        )}

        {!isJoinInputVisible && (
          <button className="card-button" onClick={() => setIsJoinInputVisible(true)}>
            Join Map
          </button>
        )}
      </div>

      {isCreateInputVisible && (
        <div className="modal">
          <div className="modal-content">
            <form onSubmit={createNewMap} className="new-map-form">
              <input
                type="text"
                value={newMapName}
                onChange={(e) => setNewMapName(e.target.value)}
                placeholder="Enter map name"
                className="new-map-input"
              />
              <div className="modal-buttons">
                <button type="submit" className="card-button">
                  Create Map
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateInputVisible(false)}
                  className="card-button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isJoinInputVisible && (
        <div className="modal">
          <div className="modal-content">
            <form onSubmit={joinMap} className="new-map-form">
              <input
                type="text"
                value={joinMapName}
                onChange={(e) => setJoinMapName(e.target.value)}
                placeholder="Enter map name"
                className="new-map-input"
              />
              <input
                type="text"
                value={joinMapId}
                onChange={(e) => setJoinMapId(e.target.value)}
                placeholder="Enter map ID"
                className="new-map-input"
              />
              {joinSuccessMessage && (
              <div className="modal">
                <div className="modal-content">
                  <p>{joinSuccessMessage}</p>
                  <button
                    className="close-button"
                    onClick={() => setJoinSuccessMessage("")}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
              {error && <p className="error-text">{error}</p>}
              <div className="modal-buttons">
                <button type="submit" className="card-button">
                  Join Map
                </button>
                <button
                  type="button"
                  onClick={() => setIsJoinInputVisible(false)}
                  className="card-button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete.isVisible && (
        <div className="modal">
          <div className="modal-content">
            <p>Are you sure you want to delete the "{confirmDelete.mapName}" map?</p>
            <div className="modal-buttons">
              <button className="card-button" onClick={confirmDeleteMap}>Yes</button>
              <button className="card-button" onClick={cancelDelete}>No</button>
            </div>
          </div>
        </div>
      )}
      
      <h3 style={{color:"#2C5F2D" }}>Your Learning Space:</h3>
      <div className="search-container"> {/* Search bar container */}
        <input
          type="text"
          placeholder="Search learning space..."
          value={searchTerm}
          onChange={handleSearch}
          className="search-input"
        />
      </div>
      <div className="maps-grid">
      {maps.map((m) => (
        <div key={m.id} className="map-tile">
          <button className="card-button" onClick={() => setSelectedMapId(m.id)}>
            {m.name || m.id}
          </button>
          <button className="delete-button" onClick={() => handleDeleteClick(m.id, m.name)}>
            <div className="trash-icon">
              <div className="lid"></div>
              <div className="bin">
                <div className="face"></div>
              </div>
            </div>
          </button>
        </div>
      ))}
    </div>
    </div>
  );
};

export default Dashboard;