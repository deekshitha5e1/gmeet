import React, { useState } from "react";
import { Bot, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function ChatbotPanel({ onClose }) {
  const navigate = useNavigate();

  const [step, setStep] = useState("topics");
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState("");

  const topics = [
    "Create Meeting",
    "Join Meeting",
    "Schedule Meeting",
    "Add Task",
    "General Help"
  ];

  const data = {
    "Create Meeting": {
      questions: [
        "Steps to create meeting",
        "Add participants",
        "Start meeting",
        "Back to main menu"
      ],
      answers: {
        "Steps to create meeting": `To create a meeting:
1. Click 'New Meeting'
2. Choose Instant or Schedule
3. Add participants
4. Start meeting`,
        "Add participants": `To add participants:
1. Enter email IDs
2. Share meeting link
3. Invite directly`,
        "Start meeting": `To start meeting:
1. Click 'Start'
2. Enable mic & camera
3. Join meeting room`
      }
    },

    "Join Meeting": {
      questions: [
        "How to join meeting",
        "Enter meeting ID",
        "Back to main menu"
      ],
      answers: {
        "How to join meeting": `To join a meeting:
1. Click 'Join Meeting'
2. Enter meeting ID
3. Click Join`,
        "Enter meeting ID": `Enter the meeting ID shared with you and click join.`
      }
    },

    "Schedule Meeting": {
      questions: [
        "How to schedule meeting",
        "Edit scheduled meeting",
        "Back to main menu"
      ],
      answers: {
        "How to schedule meeting": `To schedule:
1. Go to Calendar
2. Select date & time
3. Save meeting`,
        "Edit scheduled meeting": `You can edit meeting from calendar anytime.`
      }
    },

    "Add Task": {
      questions: [
        "How to add task",
        "Edit task",
        "Back to main menu"
      ],
      answers: {
        "How to add task": `To add task:
1. Open meeting dashboard
2. Click 'Add Task'
3. Enter details
4. Save`,
        "Edit task": `Click on task → edit → save changes.`
      }
    },

    "General Help": {
      questions: [
        "What is this platform?",
        "How to use meetings?",
        "Troubleshooting issues",
        "Back to main menu"
      ],
      answers: {
        "What is this platform?": `This is a video meeting and collaboration platform where you can create, join and manage meetings.`,
        "How to use meetings?": `Steps:
1. Create or join meeting
2. Enable mic & camera
3. Start collaboration`,
        "Troubleshooting issues": `If facing issues:
- Check internet
- Allow camera/mic permissions
- Refresh the page`
      }
    }
  };

  const handleTopicClick = (topic) => {
    setSelectedTopic(topic);
    setStep("questions");
  };

  const handleQuestionClick = (question) => {
    if (question === "Back to main menu") {
      setStep("topics");
      setSelectedTopic(null);
      return;
    }

    const answer = data[selectedTopic]?.answers?.[question];

    if (answer) {
      setSelectedAnswer(answer);
      setStep("answer");
    } else {
      setSelectedAnswer("No answer found. Please contact support.");
      setStep("answer");
    }
  };

  return (
    <div className="fixed bottom-6 right-6 w-[340px] h-[520px] bg-[#f8fafc] rounded-2xl shadow-xl flex flex-col overflow-hidden border border-gray-200">

      <div className="bg-[#2563eb] text-white px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Bot size={18} />
          <span className="font-semibold text-[15px]">Help & Support</span>
        </div>
        <X onClick={onClose} className="cursor-pointer hover:opacity-80" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {step === "topics" && (
          <>
            <h3 className="text-sm font-semibold text-gray-900">
              How can we help you today?
            </h3>

            {topics.map((t, i) => (
              <div
                key={i}
                onClick={() => handleTopicClick(t)}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-blue-50 text-gray-800 font-medium"
              >
                {t}
              </div>
            ))}
          </>
        )}

        {step === "questions" && (
          <>
            <h3 className="text-sm font-semibold text-gray-900">
              {selectedTopic}
            </h3>

            {data[selectedTopic]?.questions?.length ? (
              data[selectedTopic].questions.map((q, i) => (
                <div
                  key={i}
                  onClick={() => handleQuestionClick(q)}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-blue-50 text-gray-800"
                >
                  {q}
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm">
                No help available for this topic.
              </p>
            )}
          </>
        )}

        {step === "answer" && (
          <>
            <h3 className="text-sm font-semibold text-gray-900">
              {selectedTopic}
            </h3>

            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 whitespace-pre-line">
              {selectedAnswer}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep("questions")}
                className="bg-[#2563eb] text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
              >
                More Help
              </button>
            </div>

            <div className="space-y-2">
              <div
                onClick={() => setStep("topics")}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50 text-gray-700"
              >
                Back to main menu
              </div>

              
            </div>
          </>
        )}
      </div>
    </div>
  );
}