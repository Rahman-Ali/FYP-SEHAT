import axios from "axios";


//faculty : 10.10.40.230
//itel : 192.168.4.134
//kaxhi    10.17.158.134
const BASE_IP = "10.17.158.134"; 
const BASE_URL = `http://${BASE_IP}:8000/api`;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    console.log(`Request Body:`, config.data);
    return config;
  },
  (error) => {
    console.error("Request Error:", error);
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    const errorMsg = error.response?.data?.error || error.message;
    console.error("Response Error:", error.response?.status, errorMsg);
    return Promise.reject(error);
  },
);


export const apiService = {
  
  
  _firebaseUid: null,
  

  setFirebaseUid: (uid) => {
    apiService._firebaseUid = uid;
    console.log("🔐 Firebase UID set:", uid);
  },
  

  _getFirebaseUid: () => {
    if (!apiService._firebaseUid) {
      throw new Error("Firebase UID not set. Call setFirebaseUid() first.");
    }
    return apiService._firebaseUid;
  },

 
  createChatSession: async (firebaseUid) => {
    try {
      const response = await api.post("/chat/sessions/create/", {
        firebase_uid: firebaseUid,
        title: "New Chat",
      });
      return response.data;
    } catch (error) {
      console.error("Create Session Error:", error.message);
      throw error;
    }
  },

  
  getAllSessions: async () => {
    try {
      const firebaseUid = apiService._getFirebaseUid();
      
      const response = await api.post("/chat/sessions/list/", {
        firebase_uid: firebaseUid,
      });
      
      const sessionsData = response.data || [];

      return sessionsData.map((session) => ({
        id: session.id,
        title: session.title || "New Chat",
        preview: "Tap to view history",
        timestamp: session.updated_at || new Date().toISOString(),
        messageCount: session.message_count || 0,
      }));
    } catch (error) {
      console.error("Get Sessions Error:", error.message);
      return [];
    }
  },

 
  getSessionDetail: async (sessionId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();
      
     
      const response = await api.post("/chat/sessions/detail/", {
        session_id: sessionId,
        firebase_uid: firebaseUid,
      });
      
      return response.data;
    } catch (error) {
      console.error("Get Session Detail Error:", error.message);
      throw error;
    }
  },

 
  getSessionMessages: async (sessionId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();
      
      
      const response = await api.post("/chat/messages/list/", {
        session_id: sessionId,
        firebase_uid: firebaseUid,
      });
      
      const data = response.data;
      return {
        count: data.count || 0,
        messages: data.messages || [],
      };
    } catch (error) {
      console.error("Get History Error:", error.message);
      return { count: 0, messages: [] };
    }
  },

  
sendMessage: async (sessionId, messageText) => {
  try {
    const firebaseUid = apiService._getFirebaseUid();
    
    const response = await api.post("/chat/query/", {
      session_id: sessionId,
      query: messageText,
      firebase_uid: firebaseUid,
    });

    const data = response.data;
    const botMessage = data.bot_message || {};
    
   
    return {
      userMessage: data.user_message || null,
      botMessage: {
        id: botMessage.id,
        message_text: botMessage.message_text || data.response || "I've received your message.",
        metadata: botMessage.metadata || {},
        timestamp: botMessage.timestamp,
      },
      
      advice: botMessage.message_text || data.response || "I've received your message.",
      possible_condition: botMessage.metadata?.condition || null,
      triage_level: botMessage.metadata?.triage_level || null,
      status: "success",
    };
  } catch (error) {
    console.error("Send Message Error:", error.message);
    throw error;
  }
},

  
  updateSessionTitle: async (sessionId, newTitle) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();
      
      const response = await api.patch("/chat/sessions/update-title/", {
        session_id: sessionId,
        title: newTitle,
        firebase_uid: firebaseUid,  
      });
      
      console.log("Title updated:", newTitle);
      return response.data;
    } catch (error) {
      console.error("Update Title Error:", error.message);
      return null;
    }
  },


  deleteSession: async (sessionId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();
      
      const response = await api.delete("/chat/sessions/delete/", {
        data: {  
          session_id: sessionId,
          firebase_uid: firebaseUid,
        },
      });
      
      return response.data;
    } catch (error) {
      console.error("Delete Session Error:", error.message);
      throw error;
    }
  },

 
  deleteMessage: async (messageId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();
      
      const response = await api.delete("/chat/messages/delete/", {
        data: {
          message_id: messageId,
          firebase_uid: firebaseUid,
        },
      });
      
      return response.data;
    } catch (error) {
      console.error("Delete Message Error:", error.message);
      throw error;
    }
  },

 
  healthCheck: async () => {
    try {
      const response = await api.get("/chat/health/");
      return response.data;
    } catch (error) {
      console.error("Health Check Error:", error.message);
      return { status: "error" };
    }
  },
};

export default apiService;